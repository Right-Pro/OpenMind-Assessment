<p align="center">
  <img src="https://raw.githubusercontent.com/Right-Pro/OpenMind-Assessment/main/build/icon.png" width="120" alt="OpenMind Logo">
</p>

<h1 align="center">OpenMind Assessment</h1>

<p align="center">
  开源、免费、可定制的心理测评系统<br>
  数据完全本地存储 · 支持自定义量表导入 · 内置危机预警
</p>

<p align="center">
  <a href="https://github.com/Right-Pro/OpenMind-Assessment/releases">
    <img src="https://img.shields.io/github/v/release/Right-Pro/OpenMind-Assessment?style=flat-square" alt="Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform">
</p>

---

## 为什么做 OpenMind？

市面上心理测评软件要么**贵**（几万到十几万），要么**数据上传服务器**有隐私风险。OpenMind 面向学校心理中心、小型咨询机构和个人执业咨询师，提供**完全免费、完全本地、可自定义**的测评工具。

> "你的被试数据，永远留在你的电脑上。"

## 功能特性

- **核心测评引擎** —— 支持单量表测评与套餐连续测评
- **量表自定义导入** —— 通过 JSON 格式导入自有量表，无需等待厂商更新
- **档案袋与报告导出** —— 生成 PDF/打印报告，支持 Logo 自定义
- **数据分析中心** —— 历史得分趋势图、量表对比分析、Excel 导出
- **危机预警** —— BSS / C-SSRS 自杀相关量表自动弹窗提醒
- **无障碍优化** —— 字体无极调节、高对比度模式、暗色模式
- **自动更新检测** —— 一键检查 GitHub 最新版本

## 下载安装

前往 **[Releases](https://github.com/Right-Pro/OpenMind-Assessment/releases)** 页面，下载最新版 `OpenMind Assessment Setup x.x.x.exe`，双击安装即可。

> 系统要求：Windows 10 / Windows 11

## 内置量表

内置 38+ 免费/学术通用量表，涵盖常见筛查与评估场景。以下 **6 个为初次使用默认推荐**：

| 量表 | 用途 | 题数 |
|------|------|------|
| **PHQ-9** ⭐ | 抑郁筛查（国际金标准） | 9 |
| **GAD-7** ⭐ | 焦虑筛查（国际金标准） | 7 |
| **SAS** ⭐ | 焦虑自评（国内常用） | 20 |
| **SDS** ⭐ | 抑郁自评（国内常用） | 20 |
| **PSQI** ⭐ | 睡眠质量评估 | 19 |
| **AIS** ⭐ | 失眠严重程度筛查 | 8 |

**全部量表分类：**

| 类别 | 量表 |
|------|------|
| 抑郁筛查 | PHQ-9、PHQ-15、CES-D-20、GDS-15、SDS、HCL-32、MDQ |
| 焦虑筛查 | GAD-7、SAS、DASS-21 |
| 睡眠评估 | PSQI、AIS、ISI、ESS |
| 成瘾筛查 | AUDIT、DUDIT、CAGE、FTND |
| 人格/认知 | BFI-44、BIS-11、RSES、SQ |
| 精神科症状 | SANS、SAPS、CGI、OCI-R、SAD |
| 儿童/青少年 | SDQ、ASRS-18 |
| 生活质量/社会支持 | WHO-5、ADL、AAS、CSES、SSRS、SCSQ、SERS、SDS-Sheehan |

> 支持通过**量表编辑器**或 JSON 文件导入机构自有量表。

## 截图

（此处可补充软件截图）

## 技术栈

- **Electron** —— 跨平台桌面应用框架
- **Vue 3 + TypeScript** —— 前端界面
- **Pinia** —— 状态管理
- **Element Plus** —— UI 组件库
- **SQLite (better-sqlite3)** —— 本地数据存储
- **ECharts** —— 数据可视化

## 赞助支持

如果 OpenMind 对你有帮助，欢迎赞助支持持续开发：

- **[爱发电](https://www.ifdian.net/a/Right-Pro/)** —— 请我喝快乐水 / 奶茶 ☕

赞助者名单将展示在 README 感谢列表中。

## 商业支持

开源版完全免费，适用于个人学习和小型机构。如需以下服务，请联系：

- 远程部署与安装配置
- 功能定制与二次开发
- 正版量表授权咨询
- 技术支持与培训

📧 **right-pro@outlook.com**

## 许可证

OpenMind Assessment © 2026 Right-Pro. Licensed under [Apache 2.0](LICENSE).