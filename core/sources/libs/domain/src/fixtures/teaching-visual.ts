import type {VisualTeachingProps, VisualTeachingId} from "../teaching-visual-content.js";

/** Replaceable preview data only. Production always uses the author's content. */
export const VISUAL_EXAMPLES: {[K in VisualTeachingId]: readonly [Extract<VisualTeachingProps, {templateId: K}>, Extract<VisualTeachingProps, {templateId: K}>]} = {
  "visual-timeline": [
    {templateId:"visual-timeline",content:{unit:"天",events:[{at:0,label:"提出问题",detail:"记录原始观察"},{at:2,label:"建立假设",detail:"明确可检验预测"},{at:7,label:"收集证据",detail:"在相同条件下比较"},{at:12,label:"修正解释",detail:"根据证据调整假设"}]}},
    {templateId:"visual-timeline",content:{unit:"分钟",events:[{at:0,label:"初次观察",detail:"留下变化前的记录"},{at:10,label:"改变条件",detail:"只改变一个因素"},{at:30,label:"再次观察",detail:"比较变化后的现象"}]}}
  ],
  "visual-cycle": [
    {templateId:"visual-cycle",content:{center:"学习反馈",nodes:[{label:"尝试",process:"完成一次实际尝试"},{label:"观察",process:"收集结果与错误"},{label:"解释",process:"寻找差异的原因"},{label:"调整",process:"修正方法再尝试"}]}},
    {templateId:"visual-cycle",content:{center:"材料循环",nodes:[{label:"使用",process:"物品完成用途"},{label:"回收",process:"分离可回收材料"},{label:"加工",process:"重新形成可用材料"}]}}
  ],
  "visual-decision": [
    {templateId:"visual-decision",content:{question:"这份证据能回答问题吗？",branches:[{condition:"直接观察",outcome:"检查测量条件"},{condition:"他人转述",outcome:"追溯原始来源"},{condition:"个人推测",outcome:"寻找可检验预测"}]}},
    {templateId:"visual-decision",content:{question:"当前问题能否直接求解？",branches:[{condition:"已知足够",outcome:"使用条件计算"},{condition:"条件缺失",outcome:"先补充必要信息"}]}}
  ],
  "visual-funnel": [
    {templateId:"visual-funnel",content:{unit:"条",stages:[{label:"待检查资料",value:100},{label:"与问题相关",value:60},{label:"来源可追溯",value:30},{label:"满足比较条件",value:18}]}},
    {templateId:"visual-funnel",content:{unit:"个",stages:[{label:"全部样本",value:80},{label:"条件符合",value:40},{label:"目标命中",value:12}]}}
  ],
  "visual-balance": [
    {templateId:"visual-balance",content:{unit:"元",left:{label:"方案甲",items:[{label:"材料",value:60},{label:"运输",value:20}]},right:{label:"方案乙",items:[{label:"材料",value:45},{label:"运输",value:40}]}}},
    {templateId:"visual-balance",content:{unit:"克",left:{label:"反应前",items:[{label:"物质甲",value:12},{label:"物质乙",value:8}]},right:{label:"反应后",items:[{label:"产物",value:20}]}}}
  ],
  "visual-matrix": [
    {templateId:"visual-matrix",content:{columns:["周一","周二","周三"],rows:[{label:"资料整理",values:[20,10,15]},{label:"练习",values:[10,25,30]},{label:"复盘",values:[5,10,15]}],unit:"分钟",max:30}},
    {templateId:"visual-matrix",content:{columns:["条件甲","条件乙"],rows:[{label:"组一",values:[8,4]},{label:"组二",values:[3,9]}],unit:"次",max:10}}
  ],
  "visual-proportion": [
    {templateId:"visual-proportion",content:{whole:"一小时",unit:"分钟",parts:[{label:"理解例子",value:20},{label:"独立练习",value:25},{label:"回忆核对",value:15}]}},
    {templateId:"visual-proportion",content:{whole:"示例预算",unit:"元",parts:[{label:"材料",value:120},{label:"设备",value:80},{label:"运输",value:50},{label:"备用",value:50}]}}
  ],
  "visual-network": [
    {templateId:"visual-network",content:{nodes:[{id:"sun",label:"阳光"},{id:"plant",label:"植物"},{id:"insect",label:"昆虫"},{id:"bird",label:"鸟类"}],links:[{from:"sun",to:"plant",label:"植物利用光能"},{from:"plant",to:"insect",label:"昆虫取食植物"},{from:"insect",to:"bird",label:"鸟类取食昆虫"},{from:"plant",to:"bird",label:"鸟类取食种子"}]}},
    {templateId:"visual-network",content:{nodes:[{id:"a",label:"观察"},{id:"b",label:"假设"},{id:"c",label:"预测"},{id:"d",label:"实验"},{id:"e",label:"解释"}],links:[{from:"a",to:"b",label:"从现象提出假设"},{from:"b",to:"c",label:"推出可检验预测"},{from:"c",to:"d",label:"按预测设计实验"},{from:"d",to:"e",label:"比较预测与结果"},{from:"e",to:"b",label:"必要时修正假设"}]}}
  ],
  "visual-counter": [
    {templateId:"visual-counter",content:{label:"累计练习时间",unit:"分钟",from:15,to:60,context:"示例：从15分钟增加到60分钟，增加量为45分钟。"}},
    {templateId:"visual-counter",content:{label:"剩余水量",unit:"升",from:8,to:3,context:"插值用于说明变化方向；中间值不是实测记录。"}}
  ],
  "visual-interval": [
    {templateId:"visual-interval",content:{label:"闭区间与观察值",unit:"",min:0,max:100,low:30,high:70,points:[{label:"观察甲",value:20},{label:"观察乙",value:50},{label:"观察丙",value:80}]}},
    {templateId:"visual-interval",content:{label:"工作温度示例",unit:"°C",min:-20,max:80,low:0,high:50,points:[{label:"低于范围",value:-10},{label:"边界",value:50}]}}
  ],
  "visual-hierarchy": [
    {templateId:"visual-hierarchy",content:{root:"信息的来源",groups:[{label:"直接观察",members:["测量","实验"]},{label:"间接材料",members:["文字记录","图像记录"]},{label:"推理结果",members:["归纳","演绎"]}]}},
    {templateId:"visual-hierarchy",content:{root:"植物器官",groups:[{label:"营养器官",members:["根","茎","叶"]},{label:"生殖器官",members:["花","果实","种子"]}]}}
  ],
  "visual-ranking": [
    {templateId:"visual-ranking",content:{unit:"件",before:"第一轮",after:"第二轮",items:[{label:"甲组",before:8,after:12},{label:"乙组",before:12,after:9},{label:"丙组",before:5,after:15},{label:"丁组",before:10,after:10}]}},
    {templateId:"visual-ranking",content:{unit:"分钟",before:"调整前",after:"调整后",items:[{label:"步骤甲",before:18,after:10},{label:"步骤乙",before:12,after:14},{label:"步骤丙",before:8,after:6}]}}
  ],
};

/** Maximum supported item counts and copy lengths; not production defaults. */
const long = "观察对象与条件始终完整保留".repeat(3).slice(0,18);
export const VISUAL_STRESS_EXAMPLES: Record<VisualTeachingId, VisualTeachingProps> = {
  "visual-timeline": {templateId:"visual-timeline",content:{unit:"年",events:Array.from({length:6},(_,i)=>({at:i===5?1000:i,label:long,detail:"完整保留教学证据与对象之间的关联不随讲解重新换行".repeat(3).slice(0,60)}))}},
  "visual-cycle": {templateId:"visual-cycle",content:{center:long,nodes:Array.from({length:6},()=>({label:long,process:long+"变化过程"}))}},
  "visual-decision": {templateId:"visual-decision",content:{question:(long+long+long).slice(0,42),branches:Array.from({length:4},()=>({condition:long,outcome:long+long}))}},
  "visual-funnel": {templateId:"visual-funnel",content:{unit:"个",stages:[1000000,800000,300000,20,0].map(value=>({label:long,value}))}},
  "visual-balance": {templateId:"visual-balance",content:{unit:"克",left:{label:long,items:Array.from({length:3},()=>({label:long,value:1000000}))},right:{label:long,items:Array.from({length:3},()=>({label:long,value:999999}))}}},
  "visual-matrix": {templateId:"visual-matrix",content:{unit:"次",max:1000000,columns:Array(4).fill(long),rows:Array.from({length:4},()=>({label:long,values:[1000000,0,100,999999]}))}},
  "visual-proportion": {templateId:"visual-proportion",content:{whole:long,unit:"个",parts:Array.from({length:5},(_,i)=>({label:long,value:1000000/(i+1)}))}},
  "visual-network": {templateId:"visual-network",content:{nodes:Array.from({length:7},(_,i)=>({id:`n${i}`,label:long})),links:[...Array.from({length:7},(_,i)=>({from:`n${i}`,to:`n${(i+1)%7}`,label:long})),{from:"n1",to:"n0",label:long}]}},
  "visual-counter": {templateId:"visual-counter",content:{label:long,unit:"度",from:-1000000,to:1000000,context:(long+long+long+long).slice(0,60)}},
  "visual-interval": {templateId:"visual-interval",content:{label:long,unit:"度",min:-1000000,max:1000000,low:-10,high:10,points:[-1000000,0,1,1000000].map(value=>({label:long,value}))}},
  "visual-hierarchy": {templateId:"visual-hierarchy",content:{root:long,groups:Array.from({length:4},()=>({label:long,members:[long,long,long]}))}},
  "visual-ranking": {templateId:"visual-ranking",content:{unit:"件",before:long,after:long,items:Array.from({length:5},(_,i)=>({label:long.slice(0,17)+(i+1),before:200000*(i+1),after:200000*(5-i)}))}},
};
