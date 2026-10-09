import { FEATURE_FEYNMAN } from "../features.js";

export type LearningAppGuideTopic =
  | "overview"
  | "methods"
  | "workflow"
  | "features";

const FEYNMAN_METHOD_POINT = "费曼讲解：用自己的话讲清楚，暴露理解漏洞";
const FEYNMAN_WORKFLOW_SUMMARY = "费曼讲解 → ";
const FEYNMAN_WORKFLOW_POINT = "费曼讲解：输出自己的解释，巩固深层理解";

const GUIDE_SECTIONS: Record<
  LearningAppGuideTopic,
  { title: string; summary: string; points: string[] }
> = {
  overview: {
    title: "产品定位",
    summary:
      "好会学是面向成人的 AI 自学助手：辅助你把模糊的学习愿望变成可执行、可复习、可长期保持的知识体系——辅助自学，而不是培训或上课。",
    points: [
      "从「想学什么」出发，AI 助手协助澄清目标、生成学习计划，并拆解为学习地图单元",
      "每个单元按 GELC 学习闭环推进，而不是一次性读完就结束",
      "间隔复习与主动回忆帮助知识进入长期记忆，减少学完就忘",
    ],
  },
  methods: {
    title: "高效自学原理",
    summary: "助手把经典学习科学方法嵌入日常自学流程，而不是只停留在概念介绍。",
    points: [
      "主动回忆：先尝试从记忆中提取，再对照材料，比反复重读更有效",
      ...(FEATURE_FEYNMAN ? [FEYNMAN_METHOD_POINT] : []),
      "苏格拉底式追问：通过问题修正片面或错误的理解",
      "间隔重复：在即将遗忘时复习，用更少时间保持更久",
      "知识结构化：用学习地图把零散学习目标连成网络，便于迁移应用",
    ],
  },
  workflow: {
    title: "GELC 学习闭环",
    summary: `每个学习单元按「结构化输入 → 主动回忆 → ${FEATURE_FEYNMAN ? FEYNMAN_WORKFLOW_SUMMARY : ""}苏格拉底修正 → 间隔复习」推进。`,
    points: [
      "结构化输入（SQ3R）：浏览、提问、阅读、复述、复习，建立初步理解",
      "主动回忆与测验：检验是否真正掌握，而不只是「看过」",
      ...(FEATURE_FEYNMAN ? [FEYNMAN_WORKFLOW_POINT] : []),
      "苏格拉底修正：针对薄弱点追问，纠偏并加深",
      "间隔复习：把关键内容送入复习队列，按遗忘曲线回访",
    ],
  },
  features: {
    title: "助手能力",
    summary: "围绕「目标—计划—单元—复习」的完整自学链路设计，由你主导、助手辅助。",
    points: [
      "学习目标：澄清意图、收集偏好、确认后创建目标",
      "学习计划：生成可编辑的日程化计划，匹配每日可用时间",
      "学习地图：把计划拆解为可逐个推进的学习单元",
      "单元学习：材料、笔记、测验、讲解与追问一体化",
      "复习中心：汇总到期卡片，支持集中复习",
    ],
  },
};

export function getLearningAppGuide(topic?: LearningAppGuideTopic) {
  if (topic && topic in GUIDE_SECTIONS) {
    return { sections: [GUIDE_SECTIONS[topic]] };
  }
  return { sections: Object.values(GUIDE_SECTIONS) };
}
