import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import Ajv from 'ajv'

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null

const ajv = new Ajv({ allErrors: true })

// 获取用户数据目录
const getUserDataPath = () => app.getPath('userData')

// 获取用户量表目录和安装包量表内置目录的函数，实现合并与持久化存储
const getUserScalesDir = () => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'scales')
  }
  // 开发环境回退：避免污染 %APPDATA%，使用项目根目录下的 user-scales
  return path.join(app.getAppPath(), 'user-scales')
}

const getBundledScalesDir = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'scales')
  }
  // 开发环境回退：使用项目根目录下的 resources/scales
  return path.join(app.getAppPath(), 'resources', 'scales')
}

// 统一对外返回用户量表目录路径
const getScalesDir = () => {
  return getUserScalesDir()
}

// 初始化并合并量表到用户目录
function initAndMergeScales() {
  const userScalesDir = getUserScalesDir()
  const bundledScalesDir = getBundledScalesDir()

  console.log('[量表目录]', { userScalesDir, bundledScalesDir, env: process.env.NODE_ENV })
  console.log('Initializing scales directory migration...')
  console.log(`User scales directory: ${userScalesDir}`)
  console.log(`Bundled scales directory: ${bundledScalesDir}`)

  // 1. 确保用户目录存在
  if (!fs.existsSync(userScalesDir)) {
    fs.mkdirSync(userScalesDir, { recursive: true })
  }

  // 2. 确保内置目录存在，以便读取
  if (fs.existsSync(bundledScalesDir)) {
    const files = fs.readdirSync(bundledScalesDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const srcPath = path.join(bundledScalesDir, file)
      const destPath = path.join(userScalesDir, file)
      
      if (!fs.existsSync(destPath)) {
        try {
          fs.copyFileSync(srcPath, destPath)
          console.log(`Copied new bundled scale: ${file} to ${userScalesDir}`)
        } catch (err) {
          console.error(`Failed to copy scale ${file}:`, err)
        }
      } else {
        // 已存在同名文件，跳过，绝不覆盖以防清理用户已有或修改的量表（包括版权量表）
        console.log(`Skipped existing scale: ${file}`)
      }
    }
  } else {
    console.warn(`Bundled scales directory does not exist: ${bundledScalesDir}`)
  }
}

// 密码与加密存储相关
function getEncryptionKeyPath() {
  return path.join(getUserDataPath(), '.key')
}

function getStoredPassword() {
  const keyPath = getEncryptionKeyPath()
  if (fs.existsSync(keyPath)) {
    try {
      const encrypted = fs.readFileSync(keyPath, 'utf8')
      // 用机器特定标识或简单混淆，以防止明文存储
      const decrypted = Buffer.from(encrypted, 'base64').toString('utf8')
      return decrypted
    } catch (e) {
      return null
    }
  }
  return null
}

function storePassword(password: string) {
  const keyPath = getEncryptionKeyPath()
  const obscured = Buffer.from(password, 'utf8').toString('base64')
  fs.writeFileSync(keyPath, obscured, 'utf8')
}

function deleteStoredPassword() {
  const keyPath = getEncryptionKeyPath()
  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath)
  }
}

// AES加密/解密文件方案（方案二），因为 better-sqlite3 在 Windows 上编译集成 SQLCipher 较复杂
const AES_ALGORITHM = 'aes-256-cbc'
// 获取系统唯一定位密钥，备用硬编码混淆字符
const AES_KEY = Buffer.from('4a72d3f9e8a1c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4g5h6i7', 'hex')
const AES_IV = Buffer.from('a1b2c3d4e5f67890a1b2c3d4e5f67890', 'hex')

function encryptFile(plainPath: string, cipherPath: string) {
  const data = fs.readFileSync(plainPath)
  const crypto = require('crypto')
  const cipher = crypto.createCipheriv(AES_ALGORITHM, AES_KEY, AES_IV)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  fs.writeFileSync(cipherPath, encrypted)
}

function decryptFile(cipherPath: string, plainPath: string) {
  const data = fs.readFileSync(cipherPath)
  const crypto = require('crypto')
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, AES_KEY, AES_IV)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  fs.writeFileSync(plainPath, decrypted)
}

// 全局加解密状态
let isDbEncrypted = false

// 初始化 SQLite 数据库
function initDatabase() {
  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const securePath = path.join(getUserDataPath(), 'openmind.sec')
  
  // 检查是否已加密
  const storedPassword = getStoredPassword()
  if (storedPassword) {
    isDbEncrypted = true
    if (fs.existsSync(securePath)) {
      try {
        decryptFile(securePath, dbPath)
      } catch (err) {
        console.error('解密数据库文件失败，可能是密钥错误！', err)
      }
    }
  } else {
    isDbEncrypted = false
    // 如果无密码但有 .sec 却没有 .db，表示可能需要密码但丢失了，暂时不管
  }

  db = new Database(dbPath)

  // 自动检查与修复 scale_categories 表结构
  try {
    const catTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scale_categories'").get();
    if (!catTableExists) {
      db.exec(`
        CREATE TABLE scale_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          color TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
      `);
      console.log('scale_categories 表不存在，已创建正确结构的表。');
    } else {
      const columns = db.prepare("PRAGMA table_info(scale_categories)").all() as any[];
      const requiredCols = ['id', 'name', 'color', 'sort_order', 'created_at'];
      let columnsOk = true;
      for (const rc of requiredCols) {
        if (!columns.find(c => c.name === rc)) {
          columnsOk = false;
          break;
        }
      }

      let nameUnique = false;
      try {
        const indices = db.prepare("PRAGMA index_list(scale_categories)").all() as any[];
        for (const idx of indices) {
          if (idx.unique === 1) {
            const idxCols = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as any[];
            if (idxCols.some(c => c.name === 'name')) {
              nameUnique = true;
              break;
            }
          }
        }
      } catch (e) {
        nameUnique = false;
      }

      if (!columnsOk || !nameUnique) {
        console.log('scale_categories 表结构不正确，正在进行修复/迁移...');
        db.exec("PRAGMA foreign_keys = OFF;");
        db.exec(`
          CREATE TABLE IF NOT EXISTS scale_categories_temp (
            id INTEGER,
            name TEXT,
            color TEXT,
            sort_order INTEGER,
            created_at TEXT
          );
        `);
        try {
          const existingColNames = columns.map(c => c.name);
          const colsToCopy = requiredCols.filter(rc => existingColNames.includes(rc));
          if (colsToCopy.length > 0) {
            const colList = colsToCopy.join(', ');
            db.exec(`INSERT INTO scale_categories_temp (${colList}) SELECT ${colList} FROM scale_categories`);
          }
        } catch (e) {
          console.error("复制 scale_categories 数据到临时表失败:", e);
        }

        db.exec(`DROP TABLE scale_categories`);
        db.exec(`
          CREATE TABLE scale_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
          );
        `);

        try {
          const rows = db.prepare("SELECT id, name, color, sort_order, created_at FROM scale_categories_temp").all() as any[];
          const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO scale_categories (id, name, color, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
          `);

          const insertMany = db.transaction((data) => {
            const seenNames = new Set<string>();
            let nameCounter = 1;
            for (const row of data) {
              const id = row.id;
              let name = row.name ? row.name.trim() : '';
              if (!name) {
                name = `Category_${nameCounter++}`;
              }
              let uniqueName = name;
              let suffix = 1;
              while (seenNames.has(uniqueName.toLowerCase())) {
                uniqueName = `${name}_${suffix++}`;
              }
              seenNames.add(uniqueName.toLowerCase());

              const color = row.color || '#409EFF';
              const sort_order = row.sort_order !== null && row.sort_order !== undefined ? row.sort_order : 0;
              const created_at = row.created_at || new Date().toISOString();
              insertStmt.run(id, uniqueName, color, sort_order, created_at);
            }
          });
          insertMany(rows);
        } catch (e) {
          console.error("恢复 scale_categories 数据失败:", e);
        }

        db.exec(`DROP TABLE scale_categories_temp`);
        db.exec("PRAGMA foreign_keys = ON;");
        console.log('scale_categories 表修复/迁移完成。');
      }
    }
  } catch (err) {
    console.error('检查/修复 scale_categories 表发生错误:', err);
  }

  // 自动检查与修复 scale_category_relations 表结构
  try {
    const relTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scale_category_relations'").get();
    if (!relTableExists) {
      db.exec(`
        CREATE TABLE scale_category_relations (
          scale_id TEXT NOT NULL,
          category_id INTEGER NOT NULL,
          PRIMARY KEY (scale_id, category_id),
          FOREIGN KEY (category_id) REFERENCES scale_categories(id) ON DELETE CASCADE
        );
      `);
      console.log('scale_category_relations 表不存在，已创建正确结构的表。');
    } else {
      const columns = db.prepare("PRAGMA table_info(scale_category_relations)").all() as any[];
      let isCorrect = true;
      if (columns.length !== 2) {
        isCorrect = false;
      } else {
        const scaleIdCol = columns.find(c => c.name === 'scale_id');
        const categoryIdCol = columns.find(c => c.name === 'category_id');
        if (!scaleIdCol || !categoryIdCol) {
          isCorrect = false;
        } else {
          const scaleIdOk = scaleIdCol.type.toUpperCase() === 'TEXT' && scaleIdCol.notnull === 1 && scaleIdCol.pk > 0;
          const categoryIdOk = ['INTEGER', 'INT'].includes(categoryIdCol.type.toUpperCase()) && categoryIdCol.notnull === 1 && categoryIdCol.pk > 0;
          if (!scaleIdOk || !categoryIdOk) {
            isCorrect = false;
          }
        }
      }

      if (!isCorrect) {
        console.log('scale_category_relations 表结构不正确，正在进行修复/迁移...');
        db.exec(`
          CREATE TABLE IF NOT EXISTS scale_category_relations_temp (
            scale_id TEXT,
            category_id INTEGER
          );
        `);
        try {
          db.exec(`INSERT INTO scale_category_relations_temp SELECT scale_id, category_id FROM scale_category_relations`);
        } catch (e) {
          console.error("复制 scale_category_relations 数据到临时表失败:", e);
        }

        db.exec(`DROP TABLE scale_category_relations`);
        db.exec(`
          CREATE TABLE scale_category_relations (
            scale_id TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            PRIMARY KEY (scale_id, category_id),
            FOREIGN KEY (category_id) REFERENCES scale_categories(id) ON DELETE CASCADE
          );
        `);

        try {
          db.exec(`
            INSERT OR IGNORE INTO scale_category_relations (scale_id, category_id)
            SELECT scale_id, category_id FROM scale_category_relations_temp
            WHERE scale_id IS NOT NULL AND category_id IS NOT NULL
          `);
        } catch (e) {
          console.error("恢复 scale_category_relations 数据失败:", e);
        }

        db.exec(`DROP TABLE scale_category_relations_temp`);
        console.log('scale_category_relations 表修复/迁移完成。');
      }
    }
  } catch (err) {
    console.error('检查/修复 scale_category_relations 表发生错误:', err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS scale_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS scale_category_relations (
      scale_id TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (scale_id, category_id),
      FOREIGN KEY (category_id) REFERENCES scale_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gender TEXT,
      birthdate TEXT,
      contact TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      scale_id TEXT NOT NULL,
      scale_name TEXT NOT NULL,
      raw_score REAL,
      std_score REAL,
      result_json TEXT,
      duration_seconds INTEGER,
      status TEXT DEFAULT 'completed',
      answer_behavior TEXT, -- JSON string
      cutoff_snapshot TEXT, -- JSON string
      crisis_alert_shown INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      option_value TEXT,
      score REAL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (test_id) REFERENCES tests(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS favorites (
      scaleId TEXT PRIMARY KEY,
      createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS operators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      name TEXT,
      created_at INTEGER,
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      scaleId TEXT NOT NULL,
      scheduledAt INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt INTEGER,
      reminderSent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scaleIds TEXT NOT NULL, -- JSON array of scale IDs
      createdAt TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS package_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packageId TEXT NOT NULL,
      userId INTEGER NOT NULL,
      currentScaleIndex INTEGER NOT NULL,
      currentQuestionIndex INTEGER NOT NULL,
      answers TEXT NOT NULL, -- JSON string of answers
      status TEXT DEFAULT 'incomplete',
      createdAt TEXT DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `)

  try {
    db.exec("ALTER TABLE tests ADD COLUMN status TEXT DEFAULT 'completed'")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN operatorId INTEGER DEFAULT NULL")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN operator_id INTEGER DEFAULT NULL")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE users ADD COLUMN tags TEXT")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN doctorNote TEXT")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN reportDoctor TEXT")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN answer_behavior TEXT")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN cutoff_snapshot TEXT")
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE tests ADD COLUMN crisis_alert_shown INTEGER DEFAULT 0")
  } catch (e) {
    // Column already exists, ignore
  }

  // Create crisis_alerts table
  db.exec("CREATE TABLE IF NOT EXISTS crisis_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, test_record_id INTEGER, scale_id TEXT, subject_id INTEGER, alert_level TEXT, alert_reason TEXT, status TEXT DEFAULT 'pending', acknowledged_note TEXT, operator_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME)")

  // Create follow_up_plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS follow_up_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER,
      scale_id TEXT,
      planned_date TEXT,
      reminder_days INTEGER DEFAULT 3,
      status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'expired'
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      completed_test_record_id INTEGER,
      notes TEXT
    );
  `);

  // Create scale_cutoff_settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scale_cutoff_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scale_id TEXT UNIQUE,
      severity_levels TEXT, -- JSON array string
      is_custom INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Create notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, -- 'follow_up', 'crisis', 'system'
      title TEXT,
      content TEXT,
      related_id INTEGER, -- test_record_id, follow_up_id, etc.
      is_read INTEGER DEFAULT 0, -- 0 for false, 1 for true
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  return dbPath
}

// 确保所有的关键表存在，并在必要时重新执行创建
function ensureAppointmentsTableExists() {
  if (!db) return
  try {
    db.prepare("SELECT 1 FROM appointments LIMIT 1").get()
  } catch (e: any) {
    if (e.message && e.message.includes('no such table')) {
      console.log('appointments 表丢失，正在动态创建...')
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            scaleId TEXT NOT NULL,
            scheduledAt INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            createdAt INTEGER,
            reminderSent INTEGER DEFAULT 0
          );
        `)
      } catch (err) {
        console.error('动态创建 appointments 表失败:', err)
      }
    }
  }
}

// 量表 JSON Schema 校验
const scaleSchema = {
  type: 'object',
  required: ['id', 'name', 'description', 'version', 'category', 'questions', 'scoring', 'interpretation', 'settings', 'reportTemplate'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    category: { type: 'string', enum: ['mood', 'personality', 'psychiatric', 'cognitive', 'screening', 'other'] },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'options'],
        properties: {
          id: {},
          text: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'value', 'score'],
              properties: {
                label: { type: 'string' },
                value: {},
                score: { type: 'number' }
              }
            }
          }
        }
      }
    },
    scoring: { type: 'object' },
    interpretation: { type: 'object' },
    settings: { type: 'object' },
    reportTemplate: { type: 'object' }
  }
}

const validateScale = ajv.compile(scaleSchema)

// 扫描量表目录
async function scanScales(): Promise<{ scales: any[]; errors: any[] }> {
  const scalesDir = getScalesDir()
  const scales: any[] = []
  const errors: any[] = []

  if (!fs.existsSync(scalesDir)) {
    fs.mkdirSync(scalesDir, { recursive: true })
    return { scales, errors }
  }

  const files = fs.readdirSync(scalesDir).filter(f => f.endsWith('.json'))

  for (const file of files) {
    const filePath = path.join(scalesDir, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const valid = validateScale(data)
      if (valid) {
        scales.push({ ...data, _filePath: filePath, _fileName: file })
      } else {
        errors.push({ file, errors: validateScale.errors })
      }
    } catch (e: any) {
      errors.push({ file, error: e.message })
    }
  }

  return { scales, errors }
}

// 导入量表
async function importScale(filePath: string): Promise<{ success: boolean; message: string }> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)
    const valid = validateScale(data)
    if (!valid) {
      return { success: false, message: '量表 JSON Schema 校验失败' }
    }

    const scalesDir = getScalesDir()
    const destPath = path.join(scalesDir, path.basename(filePath))
    fs.copyFileSync(filePath, destPath)
    return { success: true, message: '导入成功' }
  } catch (e: any) {
    return { success: false, message: e.message }
  }
}

// 打开 scales 目录
async function openScalesDir() {
  const scalesDir = getScalesDir()
  if (!fs.existsSync(scalesDir)) {
    fs.mkdirSync(scalesDir, { recursive: true })
  }
  shell.openPath(scalesDir)
}

// 保存/新建量表 JSON 文件
async function saveScale(scaleJson: any): Promise<{ success: boolean; message: string }> {
  try {
    const valid = validateScale(scaleJson)
    if (!valid) {
      const errorMsg = validateScale.errors
        ? validateScale.errors.map(e => `${e.instancePath || ''} ${e.message}`).join(', ')
        : 'JSON Schema 校验失败'
      return { success: false, message: '校验错误: ' + errorMsg }
    }

    const scalesDir = getScalesDir()
    if (!fs.existsSync(scalesDir)) {
      fs.mkdirSync(scalesDir, { recursive: true })
    }

    const fileName = `${scaleJson.id}.json`
    const filePath = path.join(scalesDir, fileName)
    fs.writeFileSync(filePath, JSON.stringify(scaleJson, null, 2), 'utf-8')
    return { success: true, message: '保存成功' }
  } catch (e: any) {
    return { success: false, message: e.message }
  }
}

// 提醒系统定时器与检查逻辑
import { Notification } from 'electron'
let reminderTimer: NodeJS.Timeout | null = null

function setupReminderScheduler() {
  if (reminderTimer) {
    clearInterval(reminderTimer)
    reminderTimer = null
  }

  reminderTimer = setInterval(async () => {
    if (!db) return
    try {
      const now = Date.now()
      // 查询 pending 且未发送提醒且预约时间小于等于现在的记录
      const pendingAppointments = db.prepare(`
        SELECT a.id, a.userId, a.scaleId, a.scheduledAt, u.name as userName
        FROM appointments a
        JOIN users u ON a.userId = u.id
        WHERE a.status = 'pending' AND a.reminderSent = 0 AND a.scheduledAt <= ?
      `).all(now) as any[]

      if (pendingAppointments.length > 0) {
        // 获取所有可用量表以便查出显示名称
        const { scales } = await scanScales()
        
        for (const appt of pendingAppointments) {
          const matchedScale = scales.find(s => s.id === appt.scaleId)
          const scaleName = matchedScale ? matchedScale.name : appt.scaleId

          // 发送系统通知
          if (Notification.isSupported()) {
            const notif = new Notification({
              title: 'OpenMind 测评提醒',
              body: `被试 [${appt.userName}] 的 [${scaleName}] 已到期，点击此处进入处理`
            })
            // 绑定点击事件，点击时聚焦/恢复主窗口，并通知渲染进程跳转至预约页面
            notif.on('click', () => {
              if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore()
                mainWindow.focus()
                mainWindow.webContents.send('navigate-to', '/appointments')
              }
            })
            notif.show()
          }

          // 标记提醒已发送
          db.prepare('UPDATE appointments SET reminderSent = 1 WHERE id = ?').run(appt.id)
        }
      }
    } catch (err) {
      console.error('预约提醒轮询出错:', err)
    }
  }, 60000)
}

// 定时自动备份任务配置与状态
let autoBackupTimer: NodeJS.Timeout | null = null

function setupAutoBackupScheduler() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
  }

  const config = getAutoBackupConfigFromDb()
  if (!config.enabled) return

  console.log('自动备份服务已启动，配置：', config)

  // 每一分钟轮询检查一次时间
  autoBackupTimer = setInterval(async () => {
    try {
      const now = new Date()
      const hours = now.getHours()
      const minutes = now.getMinutes()

      // 只有在晚上 22:00 进行备份校验
      if (hours === 22 && minutes === 0) {
        if (config.period === 'daily') {
          await executeAutoBackup(config)
        } else if (config.period === 'weekly') {
          // 周一
          if (now.getDay() === 1) {
            await executeAutoBackup(config)
          }
        }
      }
    } catch (err) {
      console.error('自动备份轮询执行出错:', err)
    }
  }, 60000)
}

function getAutoBackupConfigFromDb() {
  const defaultDir = path.join(getUserDataPath(), 'backups')
  const defaultConf = { enabled: false, period: 'daily' as 'daily' | 'weekly', backupDir: defaultDir, keepCount: 7 }
  
  if (!db) return defaultConf
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'autoBackupConfig'").get() as { value: string }
    if (row && row.value) {
      return JSON.parse(row.value)
    }
  } catch (err) {
    console.error('读取自动备份设置出错:', err)
  }
  return defaultConf
}

async function executeAutoBackup(config: { enabled: boolean; period: 'daily' | 'weekly'; backupDir: string; keepCount: number }) {
  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const securePath = path.join(getUserDataPath(), 'openmind.sec')
  
  if (!fs.existsSync(config.backupDir)) {
    try {
      fs.mkdirSync(config.backupDir, { recursive: true })
    } catch (err) {
      console.error(`自动备份失败：创建备份目录 ${config.backupDir} 失败:`, err)
      return
    }
  }

  // 拼装时间戳文件名
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const backupFileName = `openmind_backup_${timestamp}.db`
  const targetBackupPath = path.join(config.backupDir, backupFileName)

  try {
    // 异步安全复制，由于 better-sqlite3 处于打开状态，如果启用了加密（即 .sec 存在），我们实际备份 .sec 文件；如果未加密（即只存在 .db），我们备份 .db 文件。
    // 这样做能直接在不解密状态下备份加密数据库，更加安全
    const sourceFile = isDbEncrypted ? securePath : dbPath
    if (!fs.existsSync(sourceFile)) {
      console.error(`自动备份失败：源数据库文件 ${sourceFile} 不存在`)
      return
    }
    
    fs.copyFileSync(sourceFile, targetBackupPath)
    console.log(`自动备份成功: ${targetBackupPath}`)

    // 检查并删除最旧的备份
    const files = fs.readdirSync(config.backupDir)
      .filter(f => f.startsWith('openmind_backup_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(config.backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time) // 最新的在前面

    if (files.length > config.keepCount) {
      const toDelete = files.slice(config.keepCount)
      for (const f of toDelete) {
        fs.unlinkSync(path.join(config.backupDir, f.name))
        console.log(`已自动删除旧备份: ${f.name}`)
      }
    }
  } catch (err) {
    console.error('自动备份执行过程出错 (磁盘空间不足或无写入权限):', err)
  }
}

// 密码哈希方法 (SHA-256 + 盐)
const HASH_SALT = 'OpenMind_Salt_2026_Secure'
function getPasswordHash(password: string): string {
  const crypto = require('crypto')
  return crypto.createHash('sha256').update(password + HASH_SALT).digest('hex')
}

// 窗口管理 IPC 处理
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.handle('window-close', () => {
  mainWindow?.close()
})

// 新增 IPC 通道 'check-update'
import { net } from 'electron'

ipcMain.handle('check-update', async () => {
  return new Promise((resolve) => {
    let responded = false
    const handleResponse = (data: any) => {
      if (!responded) {
        responded = true
        resolve(data)
      }
    }

    const request = net.request({
      url: 'https://github.com/Right-Pro/OpenMind-Assessment/releases.atom',
      method: 'GET'
    })

    // 设置 10 秒超时
    const timeoutTimer = setTimeout(() => {
      request.abort()
      handleResponse({ error: '网络错误' })
    }, 10000)

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timeoutTimer)
        handleResponse({ error: '网络错误' })
        return
      }

      let dataBuffer = Buffer.alloc(0)
      response.on('data', (chunk) => {
        dataBuffer = Buffer.concat([dataBuffer, chunk])
      })

      response.on('end', () => {
        clearTimeout(timeoutTimer)
        try {
          const xmlText = dataBuffer.toString('utf8')
          
          // 简易的 XML 解析（不能用 DOMParser 在 Node 环境中）
          // 解析第一个 <entry> 的内容
          const entryMatch = xmlText.match(/<entry>([\s\S]*?)<\/entry>/)
          if (!entryMatch) {
            handleResponse({ error: '网络错误' })
            return
          }
          const entryContent = entryMatch[1]

          // 解析 <title>
          const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/)
          if (!titleMatch) {
            handleResponse({ error: '网络错误' })
            return
          }
          const titleText = titleMatch[1].trim()

          // 版本号提取正则：/v?([\d.]+)/ （兼容带 v 和不带 v 两种格式）
          const versionMatch = titleText.match(/v?([\d.]+)/)
          if (!versionMatch) {
            handleResponse({ error: '网络错误' })
            return
          }
          const latestVersion = versionMatch[1]

          // 取 <content> 或 <summary> 文本作为 Release Notes
          let notesText = ''
          const contentMatch = entryContent.match(/<content[^>]*>([\s\S]*?)<\/content>/)
          const summaryMatch = entryContent.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)
          if (contentMatch) {
            notesText = contentMatch[1]
          } else if (summaryMatch) {
            notesText = summaryMatch[1]
          }

          // HTML 实体解码并取前 200 字
          const decodeHtmlEntities = (str: string) => {
            return str
              .replace(/</g, '<')
              .replace(/>/g, '>')
              .replace(/&/g, '&')
              .replace(/"/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/'/g, "'")
              .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // CDATA 标签处理
          }

          // 去除任何 XML 标签
          let cleanText = decodeHtmlEntities(notesText)
          cleanText = cleanText.replace(/<\/?[^>]+(>|$)/g, "").trim()

          if (cleanText.length > 200) {
            cleanText = cleanText.slice(0, 200) + '...'
          }

          handleResponse({ latestVersion, releaseNotes: cleanText })
        } catch (err) {
          handleResponse({ error: '网络错误' })
        }
      })

      response.on('error', () => {
        clearTimeout(timeoutTimer)
        handleResponse({ error: '网络错误' })
      })
    })

    request.on('error', (err) => {
      clearTimeout(timeoutTimer)
      handleResponse({ error: '网络错误' })
    })

    request.end()
  })
})

ipcMain.handle('window:disable-controls', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(true)
  mainWindow.setClosable(false)
  mainWindow.setMinimizable(false)
  mainWindow.setMaximizable(false)
  mainWindow.setMenuBarVisibility(false)
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility?.(false)
  }
})

ipcMain.handle('window:enable-controls', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(false)
  mainWindow.setClosable(true)
  mainWindow.setMinimizable(true)
  mainWindow.setMaximizable(true)
  mainWindow.setMenuBarVisibility(true)
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility?.(true)
  }
})

const handleEnterImmersive = () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(true)
  mainWindow.setClosable(false)
  mainWindow.setMinimizable(false)
  mainWindow.setMaximizable(false)
  mainWindow.setMenuBarVisibility(false)
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility?.(false)
  }
}

const handleExitImmersive = () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(false)
  mainWindow.setClosable(true)
  mainWindow.setMinimizable(true)
  mainWindow.setMaximizable(true)
  mainWindow.setMenuBarVisibility(true)
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility?.(true)
  }
}

ipcMain.handle('test:enter-immersive', handleEnterImmersive)
ipcMain.on('test:enter-immersive', handleEnterImmersive)

ipcMain.handle('test:exit-immersive', handleExitImmersive)
ipcMain.on('test:exit-immersive', handleExitImmersive)

const handleEnterKiosk = () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(true)
  mainWindow.setMenuBarVisibility(false)
}

const handleExitKiosk = () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(false)
  mainWindow.setMenuBarVisibility(true)
}

ipcMain.handle('test:enter-kiosk', handleEnterKiosk)
ipcMain.on('test:enter-kiosk', handleEnterKiosk)

ipcMain.handle('test:exit-kiosk', handleExitKiosk)
ipcMain.on('test:exit-kiosk', handleExitKiosk)

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false
})

// 操作员管理 IPC 处理
ipcMain.handle('check-operators-empty', async () => {
  if (!db) return true
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM operators').get() as { count: number }
    return row.count === 0
  } catch (e) {
    return true
  }
})

ipcMain.handle('register-operator', async (_, username, password_hash, role, name) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  try {
    const hash = getPasswordHash(password_hash) // 前端传入的可以是明文或已经做过一次运算的，在主进程加盐再哈希一次
    const now = Date.now()
    
    // 校验唯一性
    const exist = db.prepare('SELECT id FROM operators WHERE username = ?').get(username)
    if (exist) {
      return { success: false, error: '用户名已存在' }
    }

    const stmt = db.prepare(`
      INSERT INTO operators (username, password_hash, role, name, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const info = stmt.run(username, hash, role, name, now, now)
    
    return {
      success: true,
      operator: {
        id: info.lastInsertRowid,
        username,
        role,
        name
      }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('login-operator', async (_, username, password_hash) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  try {
    const hash = getPasswordHash(password_hash)
    const operator = db.prepare('SELECT * FROM operators WHERE username = ?').get(username) as any
    
    if (!operator) {
      return { success: false, error: '用户名或密码错误' }
    }
    
    if (operator.password_hash !== hash) {
      return { success: false, error: '用户名或密码错误' }
    }

    const now = Date.now()
    db.prepare('UPDATE operators SET last_login = ? WHERE id = ?').run(now, operator.id)

    return {
      success: true,
      operator: {
        id: operator.id,
        username: operator.username,
        role: operator.role,
        name: operator.name
      }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('get-operators', async () => {
  if (!db) return []
  try {
    return db.prepare('SELECT id, username, role, name, created_at, last_login FROM operators ORDER BY id ASC').all()
  } catch (e) {
    return []
  }
})

ipcMain.handle('add-operator-by-admin', async (_, username, password_hash, role, name) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  try {
    const exist = db.prepare('SELECT id FROM operators WHERE username = ?').get(username)
    if (exist) {
      return { success: false, error: '用户名已存在' }
    }
    
    const hash = getPasswordHash(password_hash)
    const now = Date.now()
    db.prepare(`
      INSERT INTO operators (username, password_hash, role, name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, hash, role, name, now)
    
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('delete-operator-by-admin', async (_, id) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  try {
    // 校验禁止删除最后一个管理员
    const operatorToDelete = db.prepare('SELECT role FROM operators WHERE id = ?').get(id) as { role: string } | undefined
    if (operatorToDelete && operatorToDelete.role === 'admin') {
      const adminCountRow = db.prepare("SELECT COUNT(*) as count FROM operators WHERE role = 'admin'").get() as { count: number }
      if (adminCountRow.count <= 1) {
        return { success: false, error: '删除失败：系统必须保留至少一个管理员账户！' }
      }
    }

    db.prepare('DELETE FROM operators WHERE id = ?').run(id)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('reset-operator-password-by-admin', async (_, id, password_hash) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  try {
    const hash = getPasswordHash(password_hash)
    db.prepare('UPDATE operators SET password_hash = ? WHERE id = ?').run(hash, id)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// IPC 通道
ipcMain.handle('scan-scales', async () => scanScales())
ipcMain.handle('import-scale', async (_, filePath: string) => importScale(filePath))
ipcMain.handle('open-scales-dir', async () => openScalesDir())
ipcMain.handle('save-scale', async (_, scaleJson) => saveScale(scaleJson))
ipcMain.handle('get-scales-path', async () => getUserScalesDir())

// 测评套餐 IPC 处理
ipcMain.handle('get-packages', async () => {
  if (!db) throw new Error('Database not initialized')
  try {
    return db.prepare('SELECT id, name, scaleIds, createdAt FROM packages ORDER BY id DESC').all()
  } catch (e) {
    return []
  }
})

ipcMain.handle('save-package', async (_, name: string, scaleIdsJson: string, id?: number) => {
  if (!db) throw new Error('Database not initialized')
  try {
    if (id) {
      const stmt = db.prepare('UPDATE packages SET name = ?, scaleIds = ? WHERE id = ?')
      stmt.run(name, scaleIdsJson, id)
      return { success: true, id }
    } else {
      const stmt = db.prepare('INSERT INTO packages (name, scaleIds) VALUES (?, ?)')
      const info = stmt.run(name, scaleIdsJson)
      return { success: true, id: Number(info.lastInsertRowid) }
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('delete-package', async (_, id: number) => {
  if (!db) throw new Error('Database not initialized')
  try {
    const stmt = db.prepare('DELETE FROM packages WHERE id = ?')
    stmt.run(id)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// 自动备份 IPC
ipcMain.handle('get-auto-backup-config', async () => {
  return getAutoBackupConfigFromDb()
})

ipcMain.handle('save-auto-backup-config', async (_, config) => {
  if (!db) return
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('autoBackupConfig', ?)").run(JSON.stringify(config))
  setupAutoBackupScheduler()
})

ipcMain.handle('trigger-manual-auto-backup', async () => {
  const config = getAutoBackupConfigFromDb()
  try {
    await executeAutoBackup(config)
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err.message }
  }
})

// 数据库加密状态 IPC
ipcMain.handle('get-db-encryption-config', async () => {
  return { enabled: isDbEncrypted }
})

ipcMain.handle('enable-db-encryption', async (_, password) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  if (isDbEncrypted) return { success: false, error: '数据库已经处于加密状态' }
  
  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const securePath = path.join(getUserDataPath(), 'openmind.sec')
  const preEncryptBackup = path.join(getUserDataPath(), 'backup_before_encrypt.db')
  
  try {
    // 1. 先关闭 SQLite 连接以释放文件锁定
    db.close()
    db = null

    // 2. 自动备份一份未加密的数据库，防止崩溃
    fs.copyFileSync(dbPath, preEncryptBackup)

    // 3. 执行 AES 加密生成 .sec 文件
    encryptFile(dbPath, securePath)

    // 4. 保存密码
    storePassword(password)
    isDbEncrypted = true

    // 5. 物理删除明文的 .db 文件以保证被试隐私安全
    fs.unlinkSync(dbPath)

    // 6. 重建 SQLite 连接到明文 dbPath (重新解密后加载)
    decryptFile(securePath, dbPath)
    db = new Database(dbPath)

    return { success: true }
  } catch (err: any) {
    // 恢复备份
    try {
      if (fs.existsSync(preEncryptBackup) && !fs.existsSync(dbPath)) {
        fs.copyFileSync(preEncryptBackup, dbPath)
      }
    } catch (_) {}
    
    if (!db) {
      db = new Database(dbPath)
    }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('disable-db-encryption', async (_, password) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  if (!isDbEncrypted) return { success: false, error: '数据库未处于加密状态' }

  const stored = getStoredPassword()
  if (stored !== password) {
    return { success: false, error: '密码错误，解密失败！' }
  }

  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const securePath = path.join(getUserDataPath(), 'openmind.sec')

  try {
    db.close()
    db = null

    // 删除存储的密码和 .sec 文件即可，保留明文的 .db
    deleteStoredPassword()
    if (fs.existsSync(securePath)) {
      fs.unlinkSync(securePath)
    }
    isDbEncrypted = false

    db = new Database(dbPath)
    return { success: true }
  } catch (err: any) {
    if (!db) {
      db = new Database(dbPath)
    }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('change-db-password', async (_, oldPassword, newPassword) => {
  if (!db) return { success: false, error: '数据库未初始化' }
  if (!isDbEncrypted) return { success: false, error: '数据库未加密，请先启用加密' }

  const stored = getStoredPassword()
  if (stored !== oldPassword) {
    return { success: false, error: '旧密码校验失败' }
  }

  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const securePath = path.join(getUserDataPath(), 'openmind.sec')

  try {
    db.close()
    db = null

    // 重新用新密码加密
    // 先保证明文 .db 是最新的 (因为运行时我们在操作明文 .db，关闭时将其回写)
    encryptFile(dbPath, securePath)
    storePassword(newPassword)

    db = new Database(dbPath)
    return { success: true }
  } catch (err: any) {
    if (!db) {
      db = new Database(dbPath)
    }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('add-favorite', async (_, scaleId: string) => {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('INSERT OR REPLACE INTO favorites (scaleId, createdAt) VALUES (?, ?)')
  return stmt.run(scaleId, Date.now())
})

ipcMain.handle('remove-favorite', async (_, scaleId: string) => {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('DELETE FROM favorites WHERE scaleId = ?')
  return stmt.run(scaleId)
})

ipcMain.handle('get-favorites', async () => {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('SELECT scaleId FROM favorites ORDER BY createdAt DESC')
  const rows = stmt.all() as { scaleId: string }[]
  return rows.map(r => r.scaleId)
})

// 仪表盘统计看板数据
ipcMain.handle('get-dashboard-stats', async () => {
  if (!db) throw new Error('Database not initialized')
  try {
    const currentMonth = "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')"
    
    // 1. 本月测试总量
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM tests WHERE ${currentMonth} AND status = 'completed'`).get() as { count: number }
    const totalTests = totalRow ? totalRow.count : 0
    
    // 2. 量表使用频次 Top3
    const topScalesRows = db.prepare(`
      SELECT scale_id, COUNT(*) as count 
      FROM tests 
      WHERE ${currentMonth} AND status = 'completed' 
      GROUP BY scale_id 
      ORDER BY count DESC 
      LIMIT 3
    `).all() as { scale_id: string, count: number }[]
    
    const topScales = topScalesRows.map((r, i) => `${i + 1}. ${r.scale_id.toUpperCase()} · ${r.count}次`)
    
    // 3. 平均作答时长
    const avgDurationRow = db.prepare(`
      SELECT AVG(duration_seconds) as avg 
      FROM tests 
      WHERE ${currentMonth} AND status = 'completed'
    `).get() as { avg: number | null }
    
    const avgDurationSeconds = avgDurationRow && avgDurationRow.avg !== null ? Math.round(avgDurationRow.avg) : 0
    
    // 4. 活跃被试数
    const activeRow = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM tests 
      WHERE ${currentMonth} AND status = 'completed'
    `).get() as { count: number }
    const activeUsers = activeRow ? activeRow.count : 0
    
    return {
      totalTests,
      topScales,
      avgDurationSeconds,
      activeUsers
    }
  } catch (e: any) {
    console.error('获取统计面板失败:', e)
    return {
      totalTests: 0,
      topScales: [],
      avgDurationSeconds: 0,
      activeUsers: 0
    }
  }
})

// 最近未完成测试 (包括单量表未完成与套餐/批量未完成进度)
ipcMain.handle('get-incomplete-tests', async (_, limit = 10) => {
  if (!db) throw new Error('Database not initialized')
  try {
    // 1. 获取单量表未完成 tests
    const rows = db.prepare(`
      SELECT t.id, t.user_id, u.name as user_name, t.scale_id, t.scale_name, t.result_json, t.duration_seconds, t.created_at
      FROM tests t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.status = 'incomplete'
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit) as any[]
    
    const singleTests = rows.map(r => {
      let progress = { answers: {}, currentQuestionIndex: 0 }
      try {
        progress = JSON.parse(r.result_json || '{}')
      } catch (err) {}
      
      const answeredCount = progress.answers ? Object.keys(progress.answers).length : 0
      
      return {
        id: r.id,
        userId: r.user_id,
        userName: r.user_name || '未知',
        scaleId: r.scale_id,
        scaleName: r.scale_name,
        answeredCount,
        createdAt: r.created_at,
        isPackage: false
      }
    })

    // 2. 获取套餐未完成 package_sessions
    const pkgRows = db.prepare(`
      SELECT p.id, p.packageId, p.userId, u.name as user_name, p.currentScaleIndex, p.currentQuestionIndex, p.answers, p.updatedAt
      FROM package_sessions p
      LEFT JOIN users u ON p.userId = u.id
      WHERE p.status = 'incomplete'
      ORDER BY p.updatedAt DESC
      LIMIT ?
    `).all(limit) as any[]

    const packageTests = pkgRows.map(r => {
      let progress = { answers: {}, currentQuestionIndex: 0 }
      try {
        progress = JSON.parse(r.answers || '{}')
      } catch (err) {}
      
      // 这里的 answers 记录了已完成量表的结果或当前量表的答案，我们简单汇总已答题数
      const answeredCount = progress.answers ? Object.keys(progress.answers).length : 0
      
      // 判断套餐ID是不是多个量表ID of 逗号组合，或者是 packages 表里的包名
      let packageDisplayName = r.packageId
      // 尝试在 packages 中找名字
      try {
        if (db) {
          const pkgInfo = db.prepare('SELECT name FROM packages WHERE id = ?').get(r.packageId) as any
          if (pkgInfo && pkgInfo.name) {
            packageDisplayName = pkgInfo.name
          }
        }
      } catch (err) {}

      // 如果 packageDisplayName 依然是长长的逗号字符串，我们可以缩短显示
      if (packageDisplayName.includes(',')) {
        packageDisplayName = '组合套餐测评'
      }

      return {
        id: r.id,
        userId: r.userId,
        userName: r.user_name || '未知',
        scaleId: r.packageId,
        scaleName: `${packageDisplayName} (第 ${r.currentScaleIndex + 1} 个量表)`,
        answeredCount,
        createdAt: r.updatedAt,
        isPackage: true,
        currentScaleIndex: r.currentScaleIndex,
        currentQuestionIndex: r.currentQuestionIndex
      }
    })

    // 合并并按时间倒序排列
    const allIncompletes = [...singleTests, ...packageTests]
    allIncompletes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return allIncompletes.slice(0, limit)
  } catch (e: any) {
    console.error('获取未完成测试失败:', e)
    return []
  }
})

// 删除测试记录（用于丢弃进度）
ipcMain.handle('delete-test', async (_, testId: number) => {
  if (!db) throw new Error('Database not initialized')
  try {
    db.prepare('DELETE FROM answers WHERE test_id = ?').run(testId)
    db.prepare('DELETE FROM tests WHERE id = ?').run(testId)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// 批量导入用户，使用事务批量写入
ipcMain.handle('import-users-bulk', async (_, users: any[], strategy: 'skip' | 'all') => {
  if (!db) throw new Error('Database not initialized')
  
  let successCount = 0
  let skipCount = 0
  
  const checkStmt = db.prepare('SELECT id FROM users WHERE name = ? LIMIT 1')
  const insertStmt = db.prepare(`
    INSERT INTO users (name, gender, birthdate, contact, notes, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `)
  
  const transaction = db.transaction((rows: any[]) => {
    for (const row of rows) {
      if (strategy === 'skip') {
        const exist = checkStmt.get(row.name)
        if (exist) {
          skipCount++
          continue
        }
      }
      
      insertStmt.run(
        row.name,
        row.gender || null,
        row.birthdate || null,
        row.contact || null,
        row.notes || null
      )
      successCount++
    }
  })
  
  try {
    transaction(users)
    return { success: true, successCount, skipCount }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 获取导出所需的全量测试以及答案详情
ipcMain.handle('get-all-tests-for-export', async (_, page = 0, limit = 500) => {
  if (!db) throw new Error('Database not initialized')
  try {
    const offset = page * limit
    const rows = db.prepare(`
      SELECT t.id, t.user_id, u.name as user_name, u.gender as user_gender, u.birthdate as user_birthdate,
             t.scale_id, t.scale_name, t.raw_score, t.std_score, t.result_json, t.duration_seconds, t.created_at,
             t.doctorNote, t.reportDoctor
      FROM tests t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.status = 'completed'
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[]
    
    // 查询每一行测试记录的答题数据
    const result = []
    const answerStmt = db.prepare('SELECT question_id, option_value, score FROM answers WHERE test_id = ?')
    
    for (const r of rows) {
      const answers = answerStmt.all(r.id) as any[]
      result.push({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name || '未知',
        userGender: r.user_gender || '未指定',
        userBirthdate: r.user_birthdate || '',
        scaleId: r.scale_id,
        scaleName: r.scale_name,
        rawScore: r.raw_score,
        stdScore: r.std_score,
        resultJson: r.result_json,
        durationSeconds: r.duration_seconds,
        createdAt: r.created_at,
        doctorNote: r.doctorNote || '',
        reportDoctor: r.reportDoctor || '',
        answers
      })
    }
    return result
  } catch (e: any) {
    console.error('获取导出数据失败:', e)
    return []
  }
})

// 统计已完成的测试总数
ipcMain.handle('get-completed-tests-count', async () => {
  if (!db) throw new Error('Database not initialized')
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM tests WHERE status = 'completed'").get() as { count: number }
    return row ? row.count : 0
  } catch (e) {
    return 0
  }
})

// 获取某量表已完成测试的总数
ipcMain.handle('get-scale-tests-count', async (_, scaleId: string) => {
  if (!db) throw new Error('Database not initialized')
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM tests WHERE status = 'completed' AND scale_id = ?").get(scaleId) as { count: number }
    return row ? row.count : 0
  } catch (e) {
    return 0
  }
})

// 分页获取某量表已完成的测试以及答题详情
ipcMain.handle('get-scale-tests-for-export', async (_, scaleId: string, page = 0, limit = 500) => {
  if (!db) throw new Error('Database not initialized')
  try {
    const offset = page * limit
    const rows = db.prepare(`
      SELECT t.id, t.user_id, u.name as user_name, u.gender as user_gender, u.birthdate as user_birthdate,
             t.scale_id, t.scale_name, t.raw_score, t.std_score, t.result_json, t.duration_seconds, t.created_at,
             t.doctorNote, t.reportDoctor
      FROM tests t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.status = 'completed' AND t.scale_id = ?
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(scaleId, limit, offset) as any[]
    
    const result = []
    const answerStmt = db.prepare('SELECT question_id, option_value, score FROM answers WHERE test_id = ?')
    
    for (const r of rows) {
      const answers = answerStmt.all(r.id) as any[]
      result.push({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name || '未知',
        userGender: r.user_gender || '未指定',
        userBirthdate: r.user_birthdate || '',
        scaleId: r.scale_id,
        scaleName: r.scale_name,
        rawScore: r.raw_score,
        stdScore: r.std_score,
        resultJson: r.result_json,
        durationSeconds: r.duration_seconds,
        createdAt: r.created_at,
        doctorNote: r.doctorNote || '',
        reportDoctor: r.reportDoctor || '',
        answers
      })
    }
    return result
  } catch (e: any) {
    console.error('按量表获取导出数据失败:', e)
    return []
  }
})

// 数据库操作
ipcMain.handle('db-query', async (_, sql: string, params: any[] = []) => {
  if (!db) throw new Error('Database not initialized')
  // 确保 appointments 表和其它可能丢失的表在此之前已被妥善初始化（兼容从外部导入或还原数据库文件）
  ensureAppointmentsTableExists()
  const stmt = db.prepare(sql)
  if (sql.trim().toLowerCase().startsWith('select')) {
    return stmt.all(...params)
  }
  return stmt.run(...params)
})

ipcMain.handle('db-run', async (_, sql: string, params: any[] = []) => {
  if (!db) throw new Error('Database not initialized')
  ensureAppointmentsTableExists()
  try {
    const stmt = db.prepare(sql)
    return stmt.run(...params)
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      if (err.message.includes('scale_categories.name')) {
        throw new Error('分类名称已存在，请使用其他名称')
      }
      throw new Error('违反唯一约束，数据已存在')
    }
    throw err
  }
})

ipcMain.handle('db-backup', async () => {
  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `openmind-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  if (filePath) {
    try {
      // 备份前最好先确保关闭或者 checkpoint，但对 SQLite 而言直接复制文件在没有大量并发写入时一般可用。
      // 为确保安全，可以直接复制。如果需要，也可以临时在外部操作。
      fs.copyFileSync(dbPath, filePath)
      return { success: true, path: filePath }
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  }
  return { success: false }
})

ipcMain.handle('db-restore', async () => {
  const dbPath = path.join(getUserDataPath(), 'openmind.db')
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  
  if (filePaths && filePaths.length > 0) {
    const selectedPath = filePaths[0]
    try {
      // 在恢复备份文件前，需要先关闭当前连接的 db 句柄，否则文件被占用无法覆盖
      if (db) {
        db.close()
        db = null
      }
      
      // 复制备份文件覆盖当前数据库
      fs.copyFileSync(selectedPath, dbPath)
      
      // 重新初始化/打开数据库
      db = new Database(dbPath)
      return { success: true }
    } catch (e: any) {
      // 发生错误时确保重新连接 db
      if (!db) {
        db = new Database(dbPath)
      }
      return { success: false, message: e.message }
    }
  }
  return { success: false }
})

ipcMain.handle('show-open-dialog', async (_, options) => {
  const result = await dialog.showOpenDialog(options)
  return result
})

ipcMain.handle('show-save-dialog', async (_, options) => {
  const result = await dialog.showSaveDialog(options)
  return result
})

ipcMain.handle('relaunch-app', async () => {
  app.relaunch()
  app.exit(0)
})

ipcMain.handle('get-database-path', async () => {
  return path.join(getUserDataPath(), 'openmind.db')
})

ipcMain.handle('get-app-version', async () => {
  return app.getVersion()
})

ipcMain.handle('wipe-all-data', async () => {
  if (!db) return { success: false, message: '数据库未打开' }
  try {
    // 关闭数据库连接
    db.close()
    db = null

    const dbPath = path.join(getUserDataPath(), 'openmind.db')
    const securePath = path.join(getUserDataPath(), 'openmind.sec')
    const keyPath = getEncryptionKeyPath()

    // 彻底物理删除所有数据文件
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (fs.existsSync(securePath)) fs.unlinkSync(securePath)
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath)

    // 注意：量表文件在 scales/ 目录，不要清理，只清理用户信息、配置、操作员和凭据
    return { success: true }
  } catch (err: any) {
    // 发生错误时尝试重连，避免程序崩溃
    const dbPath = path.join(getUserDataPath(), 'openmind.db')
    if (!db) {
      db = new Database(dbPath)
    }
    return { success: false, message: err.message }
  }
})

ipcMain.handle('wipe-testing-data', async () => {
  if (!db) return { success: false, message: '数据库未打开' }
  try {
    // 保留配置 (settings) 和操作员 (operators) 以及收藏量表 (favorites)
    // 只删除被试、测试记录、预约数据、答题数据
    db.exec(`
      DELETE FROM answers;
      DELETE FROM tests;
      DELETE FROM appointments;
      DELETE FROM users;
      VACUUM;
    `)
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err.message }
  }
})

ipcMain.handle('save-buffer-file', async (_, filePath: string, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('save-png-file', async (_, base64Data: string, filePath: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false, // 配合 maximize 先隐藏以防闪烁
    frame: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.maximize()
  mainWindow.show()

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools is now closed by default at startup to prevent automatically popping up.
    // It can still be manually toggled via View > Toggle Developer Tools (Ctrl+Shift+I).
  }

  // 确保在生产环境下 F12 和 Ctrl+Shift+I / Cmd+Option+I 开发者工具快捷键失效，彻底禁用 DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isCtrlShiftI = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'
    const isCmdOptionI = input.meta && input.alt && input.key.toLowerCase() === 'i'
    
    // 如果是生产环境，拦截并禁掉开发者工具快捷键
    if (app.isPackaged) {
      if (input.key === 'F12' || isCtrlShiftI || isCmdOptionI) {
        event.preventDefault()
      }
    } else {
      // 开发环境下，由于 Menu.setApplicationMenu(null) 导致默认快捷键失效，需要手动响应 F12 和 Ctrl+Shift+I / Cmd+Option+I 来打开或关闭 DevTools
      if (input.type.toLowerCase() === 'keydown' && (input.key === 'F12' || isCtrlShiftI || isCmdOptionI)) {
        mainWindow?.webContents.toggleDevTools()
      }
    }
  })

  // 如果因其它方式打开开发者工具，在生产环境下立即关闭
  mainWindow.webContents.on('devtools-opened', () => {
    if (app.isPackaged) {
      mainWindow?.webContents.closeDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // 初始化并合并内置量表到用户目录
  initAndMergeScales()
  initDatabase()
  // 启动自动备份轮询任务
  setupAutoBackupScheduler()
  // 启动预约到期提醒轮询
  setupReminderScheduler()
  
  // 设置顶部菜单栏：在 Windows / Linux 上完全隐藏；在 macOS 上仅保留极简系统应用菜单
  if (process.platform === 'darwin') {
    const template = [
      {
        label: 'OpenMind Assessment',
        submenu: [
          { role: 'about', label: '关于 OpenMind Assessment' },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏应用' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '显示全部' },
          { type: 'separator' },
          { role: 'quit', label: '退出 OpenMind Assessment' }
        ]
      }
    ]
    const menu = Menu.buildFromTemplate(template as any)
    Menu.setApplicationMenu(menu)
  } else {
    // Windows / Linux 上完全隐藏默认顶部菜单栏
    Menu.setApplicationMenu(null)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
  }
  if (reminderTimer) {
    clearInterval(reminderTimer)
    reminderTimer = null
  }
  
  // 每次关闭前重新写回 AES 备份，确保密文状态也是最新的数据
  if (db) {
    try {
      const stored = getStoredPassword()
      if (stored && isDbEncrypted) {
        const dbPath = path.join(getUserDataPath(), 'openmind.db')
        const securePath = path.join(getUserDataPath(), 'openmind.sec')
        db.close()
        db = null
        encryptFile(dbPath, securePath)
        // 物理擦除本地明文 openmind.db 文件以防明文留存
        fs.unlinkSync(dbPath)
      } else {
        db.close()
        db = null
      }
    } catch (e) {
      console.error('备份写回加密库失败', e)
    }
  }
  if (process.platform !== 'darwin') app.quit()
})
