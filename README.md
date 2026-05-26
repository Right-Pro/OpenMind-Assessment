# OpenMind Assessment - 开源心理测评系统

> 纯本地运行、跨平台、开源免费的心理测评桌面软件。

## 核心特点

- **量表与程序完全分离**：所有量表以独立 JSON 文件存在，程序自动扫描加载
- **纯本地存储**：所有数据保存在本地 SQLite，不上传任何服务器
- **热插拔量表**：随时拖入新的量表 JSON，重启即可使用
- **模块化计分**：通用计分引擎，不硬编码任何量表逻辑

## 技术栈

- 前端：Vue 3 + Composition API + TypeScript
- UI：Element Plus（支持暗色模式）
- 图表：ECharts 5
- 桌面壳：Electron
- 数据库：SQLite（better-sqlite3）
- 导出：html2canvas + jspdf + SheetJS
- 打包：electron-builder

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 打包构建
npm run build
```

## 添加量表

1. 准备符合 [量表 JSON Schema](#量表json格式) 的 JSON 文件
2. 将 JSON 文件放入 `resources/scales/` 目录
3. 重启应用或在"量表管理"页面点击"重新扫描"

## 量表 JSON 格式

每个量表是一个独立的 JSON 文件，包含以下核心结构：

```typescript
interface ScaleDefinition {
  id: string;              // 唯一标识
  name: string;            // 显示名称
  description: string;     // 量表说明
  version: string;
  category: "mood" | "personality" | "psychiatric" | "cognitive" | "screening" | "other";
  questions: Array<{
    id: string | number;
    text: string;
    options: Array<{
      label: string;
      value: number | string;
      score: number;
    }>;
    reverse?: boolean;     // 反向计分
    dimension?: string;    // 所属维度
  }>;
  scoring: {
    type: "sum" | "average" | "weighted" | "formula";
    formula?: string;      // 如 "(sum - 20) * 1.25"
    dimensions?: Array<{   // 分维度计分
      name: string;
      questionIds: (string | number)[];
    }>;
  };
  interpretation: {
    type: "cutoff";
    cutoffs: Array<{
      min?: number;
      max?: number;
      label: string;
      severity: string;
      color: string;
      description: string;
      suggestion?: string;
    }>;
  };
  settings: {
    allowBacktrack: boolean;
    allowSkip: boolean;
    timeLimit?: number;
    minAnsweredPercent: number;
    randomizeOrder: boolean;
  };
  reportTemplate: {
    title: string;
    sections: Array<{ type: string }>;
  };
}
```

参考示例：`resources/scales/sas.json`、`resources/scales/phq-9.json`

## 项目结构

```
├── electron/           # Electron 主进程
│   ├── main.ts         # 主进程入口
│   └── preload.ts      # 预加载脚本
├── src/                # 渲染进程
│   ├── main.ts         # Vue 入口
│   ├── App.vue         # 根组件
│   ├── router/         # Vue Router
│   ├── stores/         # Pinia 状态管理
│   ├── views/          # 页面组件
│   ├── composables/    # 组合式函数
│   └── types/          # TypeScript 类型
├── resources/
│   └── scales/         # 量表 JSON 文件
└── package.json
```

## 功能模块

### Phase 1（已实现）
- [x] 项目脚手架（Electron + Vue 3 + TS + Element Plus）
- [x] SQLite 数据库初始化与连接
- [x] 量表加载器（扫描 + 校验 + 注入 Store）
- [x] 通用答题引擎（单题模式 + 导航网格 + 键盘支持）
- [x] 通用计分引擎（sum/average/formula + 反向计分）
- [x] 结果展示页（分数卡片 + ECharts 柱状图 + 文字解释）
- [x] 用户管理 + 测试历史列表
- [x] PDF/Excel 导出基础版
- [x] 暗色模式切换

### Phase 2（计划中）
- [ ] MMPI 专用计分 + 剖面图 + 效度校验
- [ ] 量表导入向导（UI 上传）
- [ ] 测试历史对比趋势图
- [ ] 打印优化

### Phase 3（计划中）
- [ ] 量表编辑器（可视化编辑 JSON）
- [ ] 数据加密（SQLite 加密）
- [ ] 多语言支持

## 隐私声明

本软件所有数据（量表文件、用户信息、测试记录）仅存储在您的本地设备，**默认不上传任何服务器**。首次启动时会弹出隐私确认对话框。

## 免责声明

> 本测试结果仅供参考，不能替代专业医疗诊断。如有心理困扰，请寻求专业心理咨询师或精神科医生的帮助。

## License

MIT
