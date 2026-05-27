export interface ElectronAPI {
  scanScales: () => Promise<{ scales: any[]; errors: any[] }>
  importScale: (filePath: string) => Promise<{ success: boolean; message: string }>
  openScalesDir: () => Promise<void>
  dbQuery: (sql: string, params?: any[]) => Promise<any[]>
  dbRun: (sql: string, params?: any[]) => Promise<any>
  dbBackup: () => Promise<{ success: boolean; path?: string; message?: string }>
  dbRestore: () => Promise<{ success: boolean; message?: string }>
  showOpenDialog: (options: any) => Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog: (options: any) => Promise<{ canceled: boolean; filePath?: string }>
  saveBufferFile: (filePath: string, base64Data: string) => Promise<{ success: boolean; error?: string }>
  savePngFile: (base64Data: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  // 自动备份相关
  getAutoBackupConfig: () => Promise<{ enabled: boolean; period: 'daily' | 'weekly'; backupDir: string; keepCount: number }>
  saveAutoBackupConfig: (config: { enabled: boolean; period: 'daily' | 'weekly'; backupDir: string; keepCount: number }) => Promise<void>
  triggerManualAutoBackup: () => Promise<{ success: boolean; message?: string }>
  // 数据库加密相关
  getDbEncryptionConfig: () => Promise<{ enabled: boolean }>
  enableDbEncryption: (password: string) => Promise<{ success: boolean; error?: string }>
  disableDbEncryption: (password: string) => Promise<{ success: boolean; error?: string }>
  changeDbPassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  addFavorite: (scaleId: string) => Promise<any>
  removeFavorite: (scaleId: string) => Promise<any>
  getFavorites: () => Promise<string[]>
  getDashboardStats: () => Promise<{
    totalTests: number
    topScales: string[]
    avgDurationSeconds: number
    activeUsers: number
  }>
  getIncompleteTests: (limit?: number) => Promise<Array<{
    id: number
    userId: number
    userName: string
    scaleId: string
    scaleName: string
    answeredCount: number
    createdAt: string
  }>>
  deleteTest: (testId: number) => Promise<{ success: boolean; error?: string }>
  importUsersBulk: (users: any[], strategy: 'skip' | 'all') => Promise<{ success: boolean; successCount: number; skipCount: number; error?: string }>
  getAllTestsForExport: (page?: number, limit?: number) => Promise<any[]>
  getCompletedTestsCount: () => Promise<number>
  getScaleTestsCount: (scaleId: string) => Promise<number>
  getScaleTestsForExport: (scaleId: string, page?: number, limit?: number) => Promise<any[]>
  // 操作员管理相关
  checkOperatorsEmpty: () => Promise<boolean>
  registerOperator: (username: string, password_hash: string, role: string, name: string) => Promise<{ success: boolean; error?: string; operator?: any }>
  loginOperator: (username: string, password_hash: string) => Promise<{ success: boolean; error?: string; operator?: any }>
  getOperators: () => Promise<any[]>
  addOperatorByAdmin: (username: string, password_hash: string, role: string, name: string) => Promise<{ success: boolean; error?: string }>
  deleteOperatorByAdmin: (id: number) => Promise<{ success: boolean; error?: string }>
  resetOperatorPasswordByAdmin: (id: number, password_hash: string) => Promise<{ success: boolean; error?: string }>
  relaunchApp: () => Promise<void>
  wipeAllData: () => Promise<{ success: boolean; message?: string }>
  wipeTestingData: () => Promise<{ success: boolean; message?: string }>
  getDatabasePath: () => Promise<string>
  onNavigate: (callback: (path: string) => void) => () => void
  // 测评套餐 API
  getPackages: () => Promise<any[]>
  savePackage: (name: string, scaleIdsJson: string, id?: number) => Promise<{ success: boolean; id?: number; error?: string }>
  deletePackage: (id: number) => Promise<{ success: boolean; error?: string }>
  // 窗口管理
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  windowDisableControls: () => Promise<void>
  windowEnableControls: () => Promise<void>
  getAppVersion: () => Promise<string>
  enterImmersive: () => Promise<void>
  exitImmersive: () => Promise<void>
  enterKiosk: () => Promise<void>
  exitKiosk: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
