export const structuredInterviewTargetCount = 12
export const structuredInterviewMaxCount = 20

export const structuredInterviewDimensions = [
  { name: '逻辑表达', focus: '语言表达、结构化叙事和自我认知' },
  { name: '专业能力', focus: '岗位核心职责、项目事实和量化结果' },
  { name: '求职动机', focus: '职业规划、加盟意愿和信息检索' },
  { name: '离职原因', focus: '离职动因、稳定性和主动规划' },
  { name: '学习能力', focus: '学习意识、复盘方法和成长证据' },
  { name: '抗压能力', focus: 'STAR案例、高强度场景和适应性' },
  { name: '稳定性', focus: '通勤、到岗安排和长期发展' },
  { name: '价值观考核', focus: '自省、向上协作和团队互补' },
]

export const structuredInterviewSystemPrompt = `你是方片HR智能招聘助手。基于结构化面试表生成可直接使用的面试题。输出严格JSON数组，每项字段：question、dimension、why、observation。题目必须结合候选人经历、意向沟通和岗位JD定制；开场话术、答疑吸引和结束语由面试官现场掌握，不要生成到题库。不得涉及歧视、婚育、隐私或违法话题。`

export function structuredFallbackQuestions(role: string) {
  return [
    { dimension: '逻辑表达', question: `请用3分钟介绍你与${role}最相关的一段经历，说明目标、分工、你的贡献、遇到的问题和最终结果。`, why: '核验表达结构和事实闭环', observation: '目标、行动、结果和反思是否完整' },
    { dimension: '专业能力', question: `请结合${role}岗位的核心职责，说明你过去负责过的最接近项目和量化结果。`, why: '核验岗位专业匹配度', observation: '职责、数据和结果是否可核验' },
    { dimension: '求职动机', question: `你选择下一份工作时最看重的三个因素是什么？它们在${role}岗位上分别如何体现？`, why: '核验求职动机和岗位匹配', observation: '动机是否清晰且与岗位一致' },
    { dimension: '离职原因', question: '请说明最近一次离职的直接原因和导火索，以及你为此做了哪些准备。', why: '核验离职动因和稳定性', observation: '归因是否客观、是否有主动规划' },
    { dimension: '学习能力', question: `请举例说明你最近一年为胜任${role}学习了什么，学习方法和验证结果是什么。`, why: '核验学习意识和复盘能力', observation: '学习闭环是否完整' },
    { dimension: '抗压能力', question: '请用STAR原则说明你经历过最有挑战的一件事，以及最终结果和复盘。', why: '核验抗压能力和解决问题的能力', observation: '情境、行动、结果和反思是否完整' },
    { dimension: '稳定性', question: '请说明你当前所在城市、通勤方式和可接受到岗时间。', why: '核验到岗可行性和稳定性', observation: '通勤和到岗安排是否明确' },
    { dimension: '价值观考核', question: '请说明最近一次工作失误的成因、处理方式、收获和后续改进。', why: '核验自省和成长导向', observation: '归因是否向内、改进是否落地' },
    { dimension: '逻辑表达', question: '请说明你把上一份工作做好的关键点，并用数据说明结果。', why: '核验总结和量化表达能力', observation: '关键点是否具体、数据是否可信' },
    { dimension: '专业能力', question: `如果让你负责${role}岗位的一项核心工作，你会如何拆解目标、安排资源和验证结果？`, why: '核验岗位方法论', observation: '目标拆解和验证是否闭环' },
    { dimension: '求职动机', question: `你对我们公司和${role}岗位了解多少？信息来源是什么？`, why: '核验信息检索和意向度', observation: '了解是否具体、来源是否可靠' },
    { dimension: '离职原因', question: '过去在职期间最接受不了的场景是什么？你当时如何处理？', why: '核验真实需求和适应性', observation: '处理方式是否成熟' },
    { dimension: '学习能力', question: '你的极致长板是什么？请用一个具体案例说明。', why: '核验自我认知和优势', observation: '长板是否具体、案例是否可信' },
    { dimension: '抗压能力', question: `这个岗位在高峰期可能需要连续高强度输出，请说明你过去类似强度和应对方式。`, why: '核验岗位强度适配', observation: '强度经验和应对方式是否具体' },
    { dimension: '稳定性', question: `如果你加入方片，未来一年你希望在${role}上取得什么成果？`, why: '核验长期发展意愿', observation: '目标是否具体、可实现' },
    { dimension: '价值观考核', question: '请评价上一位上级的管理风格，你的互补点是什么？', why: '核验向上协作和团队互补', observation: '评价是否客观、互补是否具体' },
  ]
}
