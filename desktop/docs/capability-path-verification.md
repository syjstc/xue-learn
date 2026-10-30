# 全程能力路线验证记录

日期：2026-10-20。Desktop 固定使用 Core `0.3.31`，归档 SHA-256 为 `c656dc44ecd626d7cce8629544e9fcee4090b6cc82abbcfae88130fc0fe6d1a2`。

## 已通过

| 验证 | 结果 |
| --- | --- |
| Core 构建、声明及公开入口检查 | 通过 |
| Desktop renderer、Electron main/preload 和 local runtime 构建 | 通过 |
| Core 归档与安装内容一致性 | 3270 个安装文件匹配；881 个消费端文件、214 个公开导入通过 |
| Core 定向回归 | 7 个套件，47 项通过 |
| Desktop 定向回归 | 6 个套件，16 项通过 |
| 真实 Electron + 本地服务 + SQLite 集成测试 | 通过，下述范围内无页面异常或 Goal API 错误 |

集成入口为 `node scripts/verify-capability-path-ui.mjs`。它使用临时工作区和本地模型响应夹具，从已确认的 Goal 检查点继续，运行真实自动创建、确认、审核和模块发布链路。测试不连接付费模型，也不改动学习者工作区。

确认了以下行为：

1. 全部结果尚未生成时，已显示模块和单元契约数量；出现模块标题不会提前把完整路线标成完成。
2. 刷新能恢复同一个进行中的任务，没有重复请求规划模型；长事件流继续读取后续分页。
3. 确认页展示基础假设、每个单元的入口来源、产出和检验任务。1280px 和桌面支持的最小 960px 窗口均检查了实际截图与边界。
4. “这项基础还不会”生成补桥反馈，整条路线由 3 个单元修订为 4 个，并重新验证和持久化。
5. 确认前没有单元正文、学习证据或掌握度记录。
6. 确认后发布全部 4 个单元，准确绑定跨模块前置单元 ID，使用同一组 `path:<semanticKey>` KACOM 技能身份；没有重复调用模块能力/目录编写模型，也没有提前生成正文。
7. 重复投递的模块任务可以使用空诊断列表重放；真实审核问题仍会阻止静默改写已确认的契约。

结果和截图保存在 `artifacts/capability-path-ui/`：`report.json`、`streaming-path.png`、`contract-desktop.png`、`contract-narrow.png`。

## 验证边界

此集成测试验证程序链路，模型输出和语义审核结果使用确定性夹具。它不证明真实模型对任意学科的教学质量，也未测量真实提供商的规划延迟。结构闭合不代表学习者已经掌握。

全库严格类型检查未通过，未计入以上通过项。Desktop 当前仍报告 `teaching-display.spec.tsx` 的 `require` 类型与 `assistant-course-display.ts` 的 `timelineCueId` 类型问题；Core 也仍有现有类型诊断。此次变更的契约、投影、发布及交互由上述定向测试和实际构建覆盖。

本次只更新 Core 和 Desktop。Platform、Video、Game 的固定 Core 版本未升级，既有课程不自动重规划。掌握度百分比仍仅为 Core 文档中的设计提案，没有上线评分。
