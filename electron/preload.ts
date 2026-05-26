import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  scanScales: () => ipcRenderer.invoke('scan-scales'),
  importScale: (filePath: string) => ipcRenderer.invoke('import-scale', filePath),
  openScalesDir: () => ipcRenderer.invoke('open-scales-dir'),
  dbQuery: (sql: string, params?: any[]) => ipcRenderer.invoke('db-query', sql, params),
  dbRun: (sql: string, params?: any[]) => ipcRenderer.invoke('db-run', sql, params),
  dbBackup: () => ipcRenderer.invoke('db-backup'),
  dbRestore: () => ipcRenderer.invoke('db-restore'),
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  saveBufferFile: (filePath: string, base64Data: string) => ipcRenderer.invoke('save-buffer-file', filePath, base64Data),
  savePngFile: (base64Data: string, filePath: string) => ipcRenderer.invoke('save-png-file', base64Data, filePath),
  // 自动备份相关
  getAutoBackupConfig: () => ipcRenderer.invoke('get-auto-backup-config'),
  saveAutoBackupConfig: (config: { enabled: boolean; period: 'daily' | 'weekly'; backupDir: string; keepCount: number }) => ipcRenderer.invoke('save-auto-backup-config', config),
  triggerManualAutoBackup: () => ipcRenderer.invoke('trigger-manual-auto-backup'),
  // 数据库加密相关
  getDbEncryptionConfig: () => ipcRenderer.invoke('get-db-encryption-config'),
  enableDbEncryption: (password: string) => ipcRenderer.invoke('enable-db-encryption', password),
  disableDbEncryption: (password: string) => ipcRenderer.invoke('disable-db-encryption', password),
  changeDbPassword: (oldPassword: string, newPassword: string) => ipcRenderer.invoke('change-db-password', oldPassword, newPassword),
  addFavorite: (scaleId: string) => ipcRenderer.invoke('add-favorite', scaleId),
  removeFavorite: (scaleId: string) => ipcRenderer.invoke('remove-favorite', scaleId),
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),
  getIncompleteTests: (limit?: number) => ipcRenderer.invoke('get-incomplete-tests', limit),
  deleteTest: (testId: number) => ipcRenderer.invoke('delete-test', testId),
  importUsersBulk: (users: any[], strategy: 'skip' | 'all') => ipcRenderer.invoke('import-users-bulk', users, strategy),
  getAllTestsForExport: (page?: number, limit?: number) => ipcRenderer.invoke('get-all-tests-for-export', page, limit),
  getCompletedTestsCount: () => ipcRenderer.invoke('get-completed-tests-count'),
  getScaleTestsCount: (scaleId: string) => ipcRenderer.invoke('get-scale-tests-count', scaleId),
  getScaleTestsForExport: (scaleId: string, page?: number, limit?: number) => ipcRenderer.invoke('get-scale-tests-for-export', scaleId, page, limit),
  // 操作员管理相关
  checkOperatorsEmpty: () => ipcRenderer.invoke('check-operators-empty'),
  registerOperator: (username: string, password_hash: string, role: string, name: string) => ipcRenderer.invoke('register-operator', username, password_hash, role, name),
  loginOperator: (username: string, password_hash: string) => ipcRenderer.invoke('login-operator', username, password_hash),
  getOperators: () => ipcRenderer.invoke('get-operators'),
  addOperatorByAdmin: (username: string, password_hash: string, role: string, name: string) => ipcRenderer.invoke('add-operator-by-admin', username, password_hash, role, name),
  deleteOperatorByAdmin: (id: number) => ipcRenderer.invoke('delete-operator-by-admin', id),
  resetOperatorPasswordByAdmin: (id: number, password_hash: string) => ipcRenderer.invoke('reset-operator-password-by-admin', id, password_hash),
  // 保存编辑后的量表
  saveScale: (scaleJson: any) => ipcRenderer.invoke('save-scale', scaleJson),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  wipeAllData: () => ipcRenderer.invoke('wipe-all-data'),
  wipeTestingData: () => ipcRenderer.invoke('wipe-testing-data'),
  getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
  // 监听导航事件
  onNavigate: (callback: (path: string) => void) => {
    const subscription = (_event: any, path: string) => callback(path)
    ipcRenderer.on('navigate-to', subscription)
    return () => {
      ipcRenderer.removeListener('navigate-to', subscription)
    }
  },
  // 测评套餐 API
  getPackages: () => ipcRenderer.invoke('get-packages'),
  savePackage: (name: string, scaleIdsJson: string, id?: number) => ipcRenderer.invoke('save-package', name, scaleIdsJson, id),
  deletePackage: (id: number) => ipcRenderer.invoke('delete-package', id)
})
