/**
 * Mock 后端 -- 测试号不支持云开发时的内存模拟
 *
 * 联调正式 appid 时：把 USE_MOCK 改成 false，走真实云函数（utils/api.js 自动切换）。
 * 内存数据在小程序一次运行内连贯，重新编译会重置。
 */

const USE_MOCK = false;

/* ===== 景点数据（spotId 与 images/spots/*.jpg 对齐） ===== */
const SPOTS = [
  {spotId:"gugong",name:"故宫博物院",category:"博物馆",district:"东城区",address:"景山前街4号",location:{latitude:39.916345,longitude:116.397155},officialAppid:"wx13169e68a3e63e55",officialPath:"pages/index/index",officialWebUrl:"https://www.dpm.org.cn",officialAccount:"故宫博物院",qrCode:"/images/qrcodes/gugong.jpg",difficultyScore:5,audienceTags:["elder"],popularityScore:5,hasWebVersion:true,scrapingUrl:"https://www.dpm.org.cn/Home.html",reservationRequired:true },
  {spotId:"tiananmen-chenglou",name:"天安门城楼",category:"古迹",district:"东城区",address:"天安门广场北侧",location:{latitude:39.90923,longitude:116.39745},officialAppid:"",officialPath:"",officialWebUrl:"https://www.tiananmenchenglou.com",officialAccount:"天安门城楼参观预约",qrCode:"/images/qrcodes/tiananmen-chenglou.png",difficultyScore:5,audienceTags:["elder"],popularityScore:5,hasWebVersion:true,scrapingUrl:"https://www.tiananmenchenglou.com",reservationRequired:true },
  {spotId:"guobo",name:"中国国家博物馆",category:"博物馆",district:"东城区",address:"东长安街16号",location:{latitude:39.9035,longitude:116.3976},officialAppid:"wx9e2927dd595b0473",officialPath:"pages/index/index",officialWebUrl:"https://www.chnmuseum.cn",officialAccount:"国家博物馆",qrCode:"/images/qrcodes/guobo.png",difficultyScore:5,audienceTags:["elder"],popularityScore:5,hasWebVersion:true,scrapingUrl:"https://www.chnmuseum.cn",reservationRequired:true },
  {spotId:"yiheyuan",name:"颐和园",category:"公园",district:"海淀区",address:"新建宫门路19号",location:{latitude:39.99998,longitude:116.27546},officialAppid:"wxf0693a7822f75666",officialPath:"pages/home/home",officialWebUrl:"https://www.summerpalace-china.com",officialAccount:"畅游公园",qrCode:"/images/qrcodes/yiheyuan.png",difficultyScore:1,audienceTags:["family","elder"],popularityScore:5,hasWebVersion:true,scrapingUrl:"https://www.summerpalace-china.com",reservationRequired:false },
  {spotId:"tiantan",name:"天坛公园",category:"公园",district:"东城区",address:"天坛东里甲1号",location:{latitude:39.8833,longitude:116.4074},officialAppid:"wxf0693a7822f75666",officialPath:"pages/home/home",officialWebUrl:"https://www.tiantanpark.com",officialAccount:"",qrCode:"",difficultyScore:1,audienceTags:["family","elder"],popularityScore:4,hasWebVersion:true,scrapingUrl:"https://www.tiantanpark.com",reservationRequired:false },
  {spotId:"badaling",name:"八达岭长城",category:"古迹",district:"延庆区",address:"G6京藏高速58号出口",location:{latitude:40.35958,longitude:116.01998},officialAppid:"wx32de8a3dce14fe60",officialPath:"pages/index/index",officialWebUrl:"https://www.badaling.cn",officialAccount:"八达岭长城",qrCode:"/images/qrcodes/badaling.png",difficultyScore:1,audienceTags:["family"],popularityScore:5,hasWebVersion:true,scrapingUrl:"https://www.badaling.cn",reservationRequired:true },
  {spotId:"yuanmingyuan",name:"圆明园遗址公园",category:"公园",district:"海淀区",address:"清华西路28号",location:{latitude:40.0083,longitude:116.2986},officialAppid:"wx0a67e51641dbe2c6",officialPath:"",officialWebUrl:"https://www.yuanmingyuanpark.cn",officialAccount:"圆明园遗址公园",qrCode:"/images/qrcodes/yuanmingyuan.jpg",difficultyScore:1,audienceTags:["family"],popularityScore:4,hasWebVersion:true,scrapingUrl:"https://www.yuanmingyuanpark.cn",reservationRequired:false },
  {spotId:"beijing-zoo",name:"北京动物园",category:"公园",district:"西城区",address:"西直门外大街137号",location:{latitude:39.9378,longitude:116.3345},officialAppid:"wxf0693a7822f75666",officialPath:"pages/home/home",officialWebUrl:"https://www.bjzoo.com",officialAccount:"畅游公园",qrCode:"/images/qrcodes/beijing-zoo.png",difficultyScore:1,audienceTags:["family"],popularityScore:4,hasWebVersion:true,scrapingUrl:"https://www.bjzoo.com",reservationRequired:false },
  {spotId:"gongwangfu",name:"恭王府",category:"古迹",district:"西城区",address:"前海西街17号",location:{latitude:39.9365,longitude:116.3852},officialAppid:"wxb222dd7f96712443",officialPath:"",officialWebUrl:"https://www.pgm.org.cn",officialAccount:"恭王府博物馆",qrCode:"/images/qrcodes/gongwangfu.jpg",difficultyScore:2,audienceTags:["elder"],popularityScore:3,hasWebVersion:true,scrapingUrl:"https://www.pgm.org.cn",reservationRequired:true },
  {spotId:"beihai",name:"北海公园",category:"公园",district:"西城区",address:"文津街1号",location:{latitude:39.9243,longitude:116.3888},officialAppid:"wxf0693a7822f75666",officialPath:"pages/home/home",officialWebUrl:"https://www.beihaipark.com.cn",officialAccount:"畅游公园",qrCode:"/images/qrcodes/beihai.jpg",difficultyScore:1,audienceTags:["family","elder"],popularityScore:3,hasWebVersion:true,scrapingUrl:"https://www.beihaipark.com.cn",reservationRequired:false },
  {spotId:"tiananmen-square",name:"天安门广场",category:"广场",district:"东城区",address:"东长安街天安门广场",location:{latitude:39.9087,longitude:116.3975},officialAppid:"wx784eb46174db6aed",officialPath:"",officialWebUrl:"http://yuyue.tamgw.beijing.gov.cn",officialAccount:"",qrCode:"",difficultyScore:2,audienceTags:["elder"],popularityScore:5,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["升旗","天安门升旗","看升旗"] },
  {spotId:"maozhuxi-jiniantang",name:"毛主席纪念堂",category:"纪念场馆",district:"东城区",address:"天安门广场人民英雄纪念碑南侧",location:{latitude:39.9014,longitude:116.3956},officialAppid:"wx492b5d2f5b89c11e",officialPath:"",officialWebUrl:"https://cpc.people.com.cn/GB/143527/143528/",officialAccount:"",qrCode:"",difficultyScore:2,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["纪念堂"] },
  {spotId:"renmin-dahuitang",name:"人民大会堂",category:"场馆",district:"西城区",address:"西长安街天安门广场西侧",location:{latitude:39.9064,longitude:116.3938},officialAppid:"wxb2809a187df8351b",officialPath:"",officialWebUrl:"",officialAccount:"",qrCode:"",difficultyScore:2,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:false,scrapingUrl:"",aliases:["大会堂"] },
  {spotId:"junbo",name:"中国人民革命军事博物馆",category:"博物馆",district:"海淀区",address:"复兴路9号",location:{latitude:39.9078,longitude:116.3211},officialAppid:"wxe7ab4bac193578d0",officialPath:"",officialWebUrl:"http://www.jb.mil.cn",officialAccount:"中国人民革命军事博物馆",qrCode:"/images/qrcodes/junbo.jpg",difficultyScore:2,audienceTags:["family","elder"],popularityScore:5,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["军博","军事博物馆"] },
  {spotId:"ziran-bowuguan",name:"国家自然博物馆",category:"博物馆",district:"东城区",address:"天桥南大街126号",location:{latitude:39.8796,longitude:116.3952},officialAppid:"wx3ccbf39dedcfc335",officialPath:"",officialWebUrl:"https://www.nnhm.org.cn",officialAccount:"国家自然博物馆",qrCode:"/images/qrcodes/ziran-bowuguan.jpg",difficultyScore:2,audienceTags:["family"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["自然博物馆","自然博"] },
  {spotId:"kaogu-bowuguan",name:"中国考古博物馆",category:"博物馆",district:"朝阳区",address:"国家体育场北路1号院1号楼",location:{latitude:39.9985,longitude:116.3835},officialAppid:"wx48b5cc9990544897",officialPath:"",officialWebUrl:"https://cam.zglsyjy.cn",officialAccount:"中国考古博物馆",qrCode:"/images/qrcodes/kaogu-bowuguan.png",difficultyScore:2,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["考古博物馆","考古博"] },
  {spotId:"tsinghua",name:"清华大学",category:"高校",district:"海淀区",address:"清华园1号",location:{latitude:40.0023,longitude:116.3262},officialAppid:"wxef227a5869ad5e4a",officialPath:"",officialWebUrl:"https://www.tsinghua.edu.cn",officialAccount:"清华大学",qrCode:"/images/qrcodes/tsinghua.png",difficultyScore:3,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["清华","清华大学参观"] },
  {spotId:"peking-university",name:"北京大学",category:"高校",district:"海淀区",address:"颐和园路5号",location:{latitude:39.9937,longitude:116.3059},officialAppid:"wxae221464afae4826",officialPath:"",officialWebUrl:"https://www.pku.edu.cn",officialAccount:"北京大学",qrCode:"/images/qrcodes/peking-university.png",difficultyScore:3,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["北大","北京大学参观"] },
  {spotId:"kejiguan",name:"中国科技馆",category:"博物馆",district:"朝阳区",address:"北辰东路5号",location:{latitude:40.0047,longitude:116.3898},officialAppid:"wx2c0837274f1a69e1",officialPath:"",officialWebUrl:"https://www.cstm.org.cn",officialAccount:"中国科学技术馆",qrCode:"/images/qrcodes/kejiguan.jpg",difficultyScore:2,audienceTags:["family"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["科技馆","中国科学技术馆"] },
  {spotId:"meishuguan",name:"中国美术馆",category:"博物馆",district:"东城区",address:"五四大街1号",location:{latitude:39.9285,longitude:116.4108},officialAppid:"wx7988edf272d3bc05",officialPath:"",officialWebUrl:"https://www.namoc.cn",officialAccount:"中国美术馆",qrCode:"/images/qrcodes/meishuguan.png",difficultyScore:2,audienceTags:["elder"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["美术馆"] },
  {spotId:"gongyi-meishuguan",name:"中国工艺美术馆·非遗馆",category:"博物馆",district:"朝阳区",address:"湖景东路16号",location:{latitude:40.0067,longitude:116.3878},officialAppid:"",officialPath:"",officialWebUrl:"https://www.gmfyg.org.cn",officialAccount:"中国工美馆 中国非遗馆",qrCode:"/images/qrcodes/gongyi-meishuguan.png",difficultyScore:2,audienceTags:["family","elder"],popularityScore:3,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["工艺美术馆","非遗馆","工美馆"] },
  {spotId:"shoubo",name:"首都博物馆",category:"博物馆",district:"西城区",address:"复兴门外大街16号",location:{latitude:39.9066,longitude:116.3479},officialAppid:"wx79ef8066f8c5edcd",officialPath:"",officialWebUrl:"http://www.capitalmuseum.org.cn",officialAccount:"首都博物馆",qrCode:"/images/qrcodes/shoubo.jpg",difficultyScore:2,audienceTags:["family","elder"],popularityScore:3,reservationRequired:false,hasWebVersion:true,scrapingUrl:"",aliases:["首博"] },
  {spotId:"mutianyu",name:"慕田峪长城",category:"古迹",district:"怀柔区",address:"渤海镇慕田峪村",location:{latitude:40.4323,longitude:116.5651},officialAppid:"wx15e60c04826479ea",officialPath:"",officialWebUrl:"https://www.mutianyugreatwall.com",officialAccount:"慕田峪长城",qrCode:"/images/qrcodes/mutianyu.png",difficultyScore:2,audienceTags:["family"],popularityScore:4,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["慕田峪"] },
  {spotId:"kongmiao-guozijian",name:"孔庙和国子监博物馆",category:"博物馆",district:"东城区",address:"国子监街15号",location:{latitude:39.9482,longitude:116.4106},officialAppid:"",officialPath:"",officialWebUrl:"http://www.kmgzj.com",officialAccount:"孔庙和国子监博物馆",qrCode:"/images/qrcodes/kongmiao-guozijian.jpg",difficultyScore:2,audienceTags:["family","elder"],popularityScore:3,reservationRequired:false,hasWebVersion:true,scrapingUrl:"",aliases:["孔庙","国子监"] },
  {spotId:"tianwenguan",name:"北京天文馆",category:"博物馆",district:"西城区",address:"西直门外大街138号",location:{latitude:39.9411,longitude:116.3404},officialAppid:"",officialPath:"",officialWebUrl:"https://www.bjp.org.cn",officialAccount:"北京天文馆",qrCode:"/images/qrcodes/tianwenguan.png",difficultyScore:1,audienceTags:["family"],popularityScore:3,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["天文馆"] },
  {spotId:"huanqiu-yingcheng",name:"北京环球影城",category:"主题乐园",district:"通州区",address:"京哈高速与东六环交汇处西北角",location:{latitude:39.8597,longitude:116.6777},officialAppid:"wx3ba512d53df66a75",officialPath:"",officialWebUrl:"https://www.universalbeijingresort.com",officialAccount:"北京环球度假区",qrCode:"/images/qrcodes/huanqiu-yingcheng.png",difficultyScore:2,audienceTags:["family"],popularityScore:5,reservationRequired:true,hasWebVersion:true,scrapingUrl:"",aliases:["环球影城","环球度假区"] },
];

/* ===== 放票规则（与 data/rules.json 同步） ===== */
const RULES = [
  {spotId:"gugong",advanceDays:7,releaseTime:"20:00",releaseFrequency:"daily",closedDays:["monday"],specialNoticeUntil:"2026-09-14",isRolling:false,bookingTips:"每个证件每个入院日限订1张；分上午场和下午场，上午场最迟12:00检票，下午场最早11:00检票；珍宝馆和钟表馆需另购票",openTime:"旺季08:30入馆，16:00停止入馆（珍宝馆、钟表馆16:10停止入馆），17:00闭馆；淡季08:30入馆，15:30停止入馆（专馆15:40），16:30闭馆；周一闭馆（法定节假日除外）",ticketPrice:"旺季60元/人，淡季40元/人；珍宝馆10元，钟表馆10元",idRequirement:"中国大陆观众凭身份证原件，外籍观众凭护照",ageLimit:"未满18周岁中国公民免费，但需预约；60周岁以上（含）老年人旺季30元，淡季20元（两专馆半价5元）",lastCheckedDate:"2026-08-24",specialNotice:"【临时公告】故宫博物院雕版馆2026年8月11日至9月14日临时闭馆，其余区域正常参观" },
  {spotId:"tiananmen-chenglou",advanceDays:7,releaseTime:"17:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"每人每参观日限预约1次；登城楼须安检，建议轻装前往",openTime:"08:30-17:00（16:30停止检票）",ticketPrice:"15元/人",idRequirement:"须持预约时使用的身份证件原件",ageLimit:"18周岁以下、60周岁（含）以上中国公民免费；现役军人、消防救援人员、残疾人凭证件免费",lastCheckedDate:"2026-09-11",specialNotice:"" },
  {spotId:"guobo",advanceDays:7,releaseTime:"17:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"每账号每周最多预约1次，每次最多预约5人；同一证件每天1次、每月4次，3次爽约限约30日；入馆须按预约时段（9:00-11:00/11:00-13:30/13:30-16:00，旺季第三时段至16:30），迟到无法入馆",openTime:"旺季（6月1日-10月31日）09:00-17:30（16:30停止入馆），淡季09:00-17:00（16:00停止入馆），周一闭馆（法定节假日除外）",ticketPrice:"免费",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"未满14周岁未成年人须由成年人陪同参观；军人、残疾人、60岁以上老人凭证件优先",lastCheckedDate:"2026-08-24",specialNotice:"" },
  {spotId:"yiheyuan",advanceDays:7,releaseTime:"21:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"联票含德和园、佛香阁、苏州街、文昌院；园中园需二次检票，建议保留联票",openTime:"旺季06:00-20:00（19:00停止入园），淡季06:30-19:00（18:00停止入园）",ticketPrice:"旺季30元/人，淡季20元/人；联票旺季60元，淡季50元",idRequirement:"身份证原件或护照",ageLimit:"6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁（含）以上老年人免费（京籍持养老助残卡刷卡，外省市凭身份证）；6-18周岁未成年人及本科以下学生半价",lastCheckedDate:"2026-08-24",specialNotice:"",peakPrice:"旺季门票30元，联票60元",offPrice:"淡季门票20元，联票50元" },
  {spotId:"tiantan",advanceDays:7,releaseTime:"21:00",releaseFrequency:"daily",closedDays:[],closedDaysNote:"公园本体全年开放，祈年殿等园中园周一闭馆（法定节假日除外）",isRolling:false,bookingTips:"祈年殿等园内景点周一闭馆（法定节假日除外）；公园全天开放，景点需另购联票",openTime:"公园06:00-22:00（21:00停止入园），景点08:00-18:00（17:30停止进入）",ticketPrice:"旺季门票15元，联票34元；淡季门票10元，联票28元",idRequirement:"身份证原件",ageLimit:"18周岁以下未成年人免费；60周岁以上老年人凭身份证免费",lastCheckedDate:"2026-08-24",specialNotice:"",peakPrice:"旺季门票15元，联票34元",offPrice:"淡季门票10元，联票28元" },
  {spotId:"badaling",advanceDays:10,releaseTime:"00:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"通过「长城内外旅游」小程序实名预约购票（可提前约10天，每证件每日限购1张，每单最多10张、每日2单）；放票时刻以小程序实测为准；缆车、滑车另行购票；旺季人流量大，建议提前3-7天预约",openTime:"旺季06:30-16:30，淡季07:30-16:00",ticketPrice:"旺季40元/人，淡季35元/人",idRequirement:"须持预约时使用的身份证件原件",ageLimit:"未满18周岁未成年人免费；残疾人、现役军人、消防救援人员、60周岁以上老人凭有效证件免费",lastCheckedDate:"2026-08-24",specialNotice:"",peakPrice:"旺季门票40元",offPrice:"淡季门票35元" },
  {spotId:"yuanmingyuan",advanceDays:7,releaseTime:"00:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"建议购买联票参观西洋楼遗址；含大水法遗址、迷宫等景点；官方购票渠道为公众号「圆明园遗址公园」及自有小程序（不在畅游公园体系）",openTime:"旺季6:00开园，19:00停止售票/入园，21:00闭园；淡季6:30开园，17:30停止售票/入园，19:30闭园（通票停止售票前2小时停售）",ticketPrice:"大门10元/人，西洋楼遗址15元，联票25元",idRequirement:"身份证原件",ageLimit:"未满18周岁未成年人免费；60周岁以上老年人凭老年证或身份证免费",lastCheckedDate:"2026-08-24",specialNotice:"",cardPrice:"大门10元，联票25元" },
  {spotId:"beijing-zoo",advanceDays:7,releaseTime:"00:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"大熊猫馆限流，建议购买联票；熊猫馆高峰时段需排队",openTime:"旺季7:30开始入园，18:00停止入园，19:00闭园；淡季7:30开始入园，17:00停止入园，18:00闭园",ticketPrice:"旺季15元/人，淡季10元/人；联票（含熊猫馆）旺季19元，淡季14元",idRequirement:"身份证原件",ageLimit:"6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证免费",lastCheckedDate:"2026-08-24",specialNotice:"",peakPrice:"旺季门票15元，联票（含熊猫馆）19元",offPrice:"淡季门票10元，联票（含熊猫馆）14元" },
  {spotId:"gongwangfu",advanceDays:10,releaseTime:"20:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"最早可于参观十日前20:00开始预订；每个证件每个入馆日限购1张（个人每订单限5张、每日2订单）；实行限流预售（单日最大承载量24000人次），节假日易约满，建议放票时卡点抢票",openTime:"08:30-17:00（16:00停止售票，16:10停止入馆），周一闭馆（法定节假日除外）",ticketPrice:"40元/人",idRequirement:"须持预约时使用的身份证件原件",ageLimit:"6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证半价（20元）",lastCheckedDate:"2026-08-24",specialNotice:"",cardPrice:"40元/人" },
  {spotId:"beihai",advanceDays:7,releaseTime:"00:00",releaseFrequency:"daily",closedDays:[],closedDaysNote:"公园本体全年开放，琼华岛等园中园周一闭馆（法定节假日除外）",isRolling:false,bookingTips:"琼华岛等园内景点周一闭馆（法定节假日除外）；白塔位于琼华岛山顶",openTime:"旺季06:00-21:00（20:30停止入园），淡季06:30-20:00（19:30停止入园）",ticketPrice:"旺季门票10元，联票20元；淡季门票5元，联票15元",idRequirement:"身份证原件",ageLimit:"6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证免费",lastCheckedDate:"2026-08-24",specialNotice:"",peakPrice:"旺季门票10元，联票20元",offPrice:"淡季门票5元，联票15元" },
  {advanceDays:7,releaseTime:"12:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"可提前1-7天预约，每日12:00分批更新可预约票量，分升旗/上午/下午/降旗时段；观看升旗须单独预约升旗时段；节假日和暑期放票后几分钟即约满，建议设闹钟卡点",openTime:"升旗时段以官方当日公示为准；广场开放约 05:00-22:00（以官方为准）",ticketPrice:"免费",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"全员实名预约，无免约通道",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"tiananmen-square" },
  {advanceDays:6,releaseTime:"12:30",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前1-6天预约，每日12:30放票（12:38、12:50固定补放）；每账号最多约5人；严禁携带照相机、摄像机、平板电脑、水杯等，手机须关机或静音，须安检",openTime:"08:00-12:00（仅上午瞻仰，以官方公示为准）",ticketPrice:"免费",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"全员实名预约，无免约通道",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"maozhuxi-jiniantang" },
  {advanceDays:3,releaseTime:"17:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"实名预约，不设现场售票，不售当日票和团队票；提前3天、每日17:00放第三日票；周一闭馆（法定节假日除外）；须按预约时段参观，携带身份证原件；单笔订单限5张，免票人群也需预约；遇全国两会、重大外事活动临时停止参观，开放安排以小程序当日公示为准",openTime:"09:00-15:00（14:30停止检票），周一闭馆，以小程序当日公示为准",ticketPrice:"30元/人（学生票15元）",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"18周岁以下、60周岁（含）以上中国公民及现役军人、消防救援人员、残疾人预约后免费",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"renmin-dahuitang" },
  {advanceDays:8,releaseTime:"08:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前8天可约；常规每日8:00、17:00、20:00三个放票时段；2026暑期（7月27日至8月31日）每日9:00、17:00释放次日回流票，9月起以官网/公众号为准；卡点进入，约不上别退出持续刷新",openTime:"09:00-17:00（16:00停止入馆），周一闭馆",ticketPrice:"免费",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"未满14周岁未成年人须由成年人陪同（以官方为准）",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"junbo",releaseTimes:["08:00","17:00","20:00"] },
  {advanceDays:3,releaseTime:"11:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前3天放票，每日11:00开抢（团体票10:00）；周末票比国博还难抢（场馆小票少），放票后几分钟约满；建议提前录好同行人信息、定闹钟卡点",openTime:"09:00-17:00（16:30停止入馆），周一闭馆",ticketPrice:"免费（收费临展另购）",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"儿童无论年龄均需单独预约（以官方为准）",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"ziran-bowuguan" },
  {advanceDays:3,releaseTime:"09:00",releaseFrequency:"daily",closedDays:["monday","tuesday"],isRolling:false,bookingTips:"提前3天9:00放票，周末秒空（开馆初期官方口径每日限量暂定500人，当前限额以官方为准）；周二仅接受团体预约，散客无法入内；放票后建议持续刷新",openTime:"09:00-16:30（16:00停止检票）；周一闭馆，周二仅团体",ticketPrice:"免费",idRequirement:"须持预约时使用的有效身份证件原件",ageLimit:"以官方公示为准",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"kaogu-bowuguan" },
  {advanceDays:7,releaseTime:"08:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"通过「参观清华」小程序实名预约，双轨制：即时预约每日8:00-17:00（工作日最多提前1天，周末及节假日最多提前7天）；抽签预约每日17:00-21:45（工作日最多提前2天，周末及节假日最多提前8天，22:00公布中签）；每人每180天仅可成功预约1次",openTime:"开放日入校时段：上午8:00-11:00、下午13:00-16:00（11:00/16:00停止入校），以「参观清华」小程序当期公告为准",ticketPrice:"免费",idRequirement:"实名认证，入校时人证核验",ageLimit:"以官方公示为准",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"tsinghua" },
  {advanceDays:7,releaseTime:"08:00",releaseFrequency:"daily",closedDays:[],openDays:["saturday","sunday"],isRolling:false,bookingTips:"通过「参观北大」小程序实名预约，双轨制：即时预约每日8:00-17:00（最多提前7日）；抽签预约每日17:00-21:45（最多提前8日）；预约成功后90日内不可重复预约；入校时段 8:00-11:00、13:00-16:00，东侧门人证核验入校，当日19:00前离校；注意：平时工作日（周一至周五）不可预约参观，仅周末及法定节假日可约，寒暑假等假期安排以学校公告为准",openTime:"入校时段 8:00-11:00、13:00-16:00（以官方为准）",ticketPrice:"免费",idRequirement:"实名预约，入校时人证核验",ageLimit:"以官方公示为准",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"peking-university" },
  {advanceDays:7,releaseTime:"18:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前7天约18:00放票（曾为24:00，以官方为准）；主展厅票较充足，球幕/巨幕影院最难约，建议电脑端优先抢影院票",openTime:"09:30-17:00（16:30停止入馆），周一闭馆（以官方为准）",ticketPrice:"主展厅30元/人（以官方为准）；特效影院另购",idRequirement:"实名预约，凭有效身份证件入馆",ageLimit:"以官方公示为准",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"kejiguan" },
  {advanceDays:7,releaseTime:"16:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前7日实名预约，每日16:00放票，日限6000人；周末及节假日名额紧张，建议卡点预约",openTime:"09:00-17:00（16:00停止入馆），周一闭馆",ticketPrice:"免费",idRequirement:"实名预约，凭有效身份证件入馆",ageLimit:"以官方公示为准",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"meishuguan" },
  {advanceDays:7,releaseTime:"00:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"提前7日实名预约（放票时刻以官方为准）；周末和节假日只接受线上预约",openTime:"09:00-17:00（16:00停止入馆），周一闭馆",ticketPrice:"免费",idRequirement:"实名预约，凭有效身份证件入馆",ageLimit:"70周岁以上老人、现役军人、残障人士可现场协助办理（以官方为准）",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"gongyi-meishuguan" },
  {advanceDays:null,releaseTime:"",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"2025-12-20 起免预约，携带身份证北侧入口登记入馆（以官方为准）；临展可能需单独购票",openTime:"09:00-20:00（19:00停止入馆），周一闭馆",ticketPrice:"免费（临展另购）",idRequirement:"实名预约，凭有效身份证件入馆",ageLimit:"以官方公示为准",lastCheckedDate:"2026-09-11",specialNotice:"",spotId:"shoubo" },
  {advanceDays:30,releaseTime:"00:00",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"实名制预约购票，可提前30天（官网口径），每证件每日限购1张；票量充足，旺季建议提前线上购票；缆车/滑道另行购票",openTime:"旺季（3月16日-11月15日）平日7:30-18:00、周末7:30-18:30；淡季（11月16日-3月15日）8:00-17:30",ticketPrice:"旺季45元/人，淡季35元（以官方为准）",idRequirement:"实名购票，刷身份证入园",ageLimit:"18周岁（含）以下中国籍（含港澳台）未成年人免票（需成人陪护）；60周岁（含）以上持北京通-养老助残卡等有效证件免费，外埠60周岁以上为优惠票",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"mutianyu" },
  {advanceDays:3,releaseTime:"19:00",releaseFrequency:"daily",closedDays:["monday"],isRolling:false,bookingTips:"无需预约，可现场扫码或人工窗口购票；线上购票可购当日起3日内门票，每日19:00更新购票日期；本馆未授权任何第三方代理门票业务",openTime:"09:00-17:00（16:30停止入馆，当日购票截止16:30），周一闭馆",ticketPrice:"30元/人（全日制本专科学生半价15元）",idRequirement:"实名购票，凭身份证/二维码入馆",ageLimit:"未满18周岁中国公民（含港澳台及永居外国人）、60周岁及以上老人免费（以官方为准）",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"kongmiao-guozijian" },
  {advanceDays:3,releaseTime:"18:30",releaseFrequency:"daily",closedDays:["tuesday"],isRolling:false,bookingTips:"实名预约购票，可购3日内（含当日）展厅票、剧场票，每单限额6张；2026暑期（7月3日起）每日18:30线上开售，常规固定放票时刻以公众号通知为准；购剧场票可免费参观展厅；剧场票较抢手，建议提前购票",openTime:"09:00-16:30（16:00停止入馆），周二闭馆",ticketPrice:"展厅票成人10元/人、学生5元/人（以官方为准）；剧场票另购",idRequirement:"实名购票",ageLimit:"未成年人、60周岁以上老人、军人警察消防人员、残疾人等展厅免费（免费不免票，须购票预约）",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"tianwenguan" },
  {advanceDays:7,releaseTime:"",releaseFrequency:"daily",closedDays:[],isRolling:false,bookingTips:"购票型乐园：官方App/小程序购票，指定日门票无需二次预约、随买随用售完即止；非指定日门票及年卡用户须提前线上预约入园；票价以官方价格日历为准（淡季418/平季528/旺季638/特定日748元档），谨防黄牛",openTime:"以官方App当日公示为准",ticketPrice:"淡季418元起，旺季638-748元（以官方价格日历为准）",idRequirement:"实名购票，凭身份证/人脸入园",ageLimit:"以官方公示为准",lastCheckedDate:"2026-08-24",specialNotice:"",spotId:"huanqiu-yingcheng" },
];

/* ===== 内存数据库（一次运行内连贯，重新编译重置） ===== */
const db = {
  trips: {},
  carts: {},
  tasks: {},
  feedbacks: {},
  searchHistory: [],
};
let tripSeq = 0;
let cartSeq = 0;
let taskSeq = 0;
let feedbackSeq = 0;
let subscribeSeq = 0;
const subscribeQuotas = {};

/* ===== GMT+8 统一时间层（镜像 cloudfunctions/reminder/lib/time.js，TIME-RULE-001） ===== */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad(n) { return String(n).padStart(2, '0'); }
function beijingParts(date = new Date()) {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    dayName: DAY_NAMES[shifted.getUTCDay()],
  };
}
function toDateStr(date = new Date()) {
  const p = beijingParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function fmt(date) { return toDateStr(date); }
function parseBeijing(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - BEIJING_OFFSET_MS);
}
function addDays(dateStr, days) {
  const base = parseBeijing(dateStr, '00:00');
  return toDateStr(new Date(base.getTime() + days * DAY_MS));
}
function diffDays(a, b) {
  return Math.round((parseBeijing(b, '00:00') - parseBeijing(a, '00:00')) / DAY_MS);
}
function dayNameOf(dateStr) { return beijingParts(parseBeijing(dateStr, '12:00')).dayName; }
function dateRange(startDate, endDate) {
  const out = [];
  const total = diffDays(startDate, endDate);
  for (let i = 0; i <= total; i += 1) out.push(addDays(startDate, i));
  return out;
}
function formatMonthDayWeek(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日 (周${cn[p.weekday]})`;
}
function formatMonthDay(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  return `${p.month}月${p.day}日`;
}
function formatMonthDayWeekCn(dateStr) {
  const p = beijingParts(parseBeijing(dateStr, '12:00'));
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${p.month}月${p.day}日（周${cn[p.weekday]}）`;
}
function formatHourMinute(date) {
  const p = beijingParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/* ===== 卡片组装（镜像 cloudfunctions/spots，TAG-RULE-001 / 2026 分层） ===== */
function computeDifficultyLabel(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约', color: 'red' };
  if (score === 3) return { key: 'NORMAL', text: '较难约', color: 'orange' };
  return { key: 'EASY', text: '容易约', color: 'green' };
}
const DAY_CN = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日' };
/* 镜像 cloudfunctions/spots：四态 —— openDays 白名单 → closedDays 黑名单 → closedDaysNote（园中园） → 全年开放 */
function closedDaysLabel(days, openDays, note) {
  const open = openDays || [];
  if (open.length > 0) return '仅' + open.map(d => DAY_CN[d] || d).join('、') + '开放';
  if (days && days.length > 0) return days.map(d => DAY_CN[d] || d).join('、') + '闭馆';
  if (note) return note;
  return '全年开放';
}
/* 镜像 cloudfunctions/spots：公告过了 specialNoticeUntil（含当天）自动不下发 */
function activeNoticeOf(rule) {
  if (!rule || !rule.specialNotice) return '';
  const until = rule.specialNoticeUntil;
  if (!until) return rule.specialNotice;
  return toDateStr(new Date()) <= until ? rule.specialNotice : '';
}
/* 镜像 cloudfunctions/spots：openDays 白名单优先，不与 closedDays 叠加 */
function isOpenOn(rule, dayName) {
  if (!rule) return true;
  const open = rule.openDays || [];
  if (open.length > 0) return open.includes(dayName);
  return !(rule.closedDays || []).includes(dayName);
}
function computeReleaseStatus(rule, now = new Date()) {
  if (!rule || !rule.releaseTime) return 'NOT_RELEASED';
  const p = beijingParts(now);
  if (!isOpenOn(rule, p.dayName)) return 'NOT_RELEASED';
  const [h, m] = rule.releaseTime.split(':').map(Number);
  if (p.hour * 60 + p.minute < h * 60 + m) return 'NOT_RELEASED';
  return 'BOOKABLE';
}
function computeEarliestDate(rule, now = new Date()) {
  if (!rule || !rule.advanceDays) return null;
  let target = addDays(toDateStr(now), rule.advanceDays);
  for (let i = 0; i < 7; i += 1) {
    if (isOpenOn(rule, dayNameOf(target))) return target;
    target = addDays(target, 1);
  }
  return null;
}
function cardDescOf(rule, now = new Date()) {
  if (!rule) return '';
  const p = beijingParts(now);
  if (rule.peakPrice || rule.offPrice) {
    const isPeak = p.month >= 4 && p.month <= 10;
    const frag = (isPeak ? rule.peakPrice : rule.offPrice) || rule.peakPrice || rule.offPrice;
    return '随到随买，当前' + frag;
  }
  const base = rule.cardPrice || rule.ticketPrice || '';
  return base ? '随到随买，' + base : '';
}
function weakLine(rule) {
  if (!rule) return '票量充足，无需卡点抢票';
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) {
    const adv = rule.advanceDays ? `提前${rule.advanceDays}天 ` : '';
    return `${adv}${Array.isArray(rt) ? rt.join('、') : rt}放票 · 票量充足，无需卡点`;
  }
  return '票量充足，无需卡点抢票';
}
function buildTags(rule) {
  const t = [];
  if (rule.advanceDays) t.push(`提前${rule.advanceDays}天放票`);
  const rt = rule.releaseTimes || rule.releaseTime;
  if (rt) t.push(`每日${Array.isArray(rt) ? rt.join('、') : rt}放票`);
  return t;
}
function buildCard(spot) {
  const now = new Date();
  const rule = RULES.find(r => r.spotId === spot.spotId) || null;
  const status = computeReleaseStatus(rule, now);
  const remindable = spot.reservationRequired !== false && !!(rule && rule.advanceDays && (rule.releaseTimes || rule.releaseTime));
  const weak = spot.reservationRequired !== false && (spot.difficultyScore || 0) <= 2;
  let cardDesc = cardDescOf(rule, now);
  if (remindable && weak) cardDesc = weakLine(rule);
  else if (!remindable && spot.reservationRequired !== false) cardDesc = '无固定放票时刻，随买随用';
  return {
    spotId: spot.spotId,
    name: spot.name,
    category: spot.category,
    audienceTags: spot.audienceTags || [],
    district: spot.district,
    difficultyScore: spot.difficultyScore,
    difficultyLabel: computeDifficultyLabel(spot.difficultyScore),
    popularityScore: spot.popularityScore,
    reservationRequired: spot.reservationRequired !== false,
    remindable,
    weak,
    cardDesc,
    tags: rule ? buildTags(rule) : [],
    advanceDays: rule ? rule.advanceDays : null,
    releaseTime: rule ? (rule.releaseTimes || rule.releaseTime) : null,
    ticketPrice: rule ? (rule.ticketPrice || '') : '',
    openTime: rule ? (rule.openTime || '') : '',
    closedDays: rule ? (rule.closedDays || []) : [],
    openDays: rule ? (rule.openDays || []) : [],
    releaseStatus: status,
    earliestDate: computeEarliestDate(rule, now),
    lastCheckedDate: rule ? (rule.lastCheckedDate || '') : '',
    officialAppid: spot.officialAppid || '',
    officialPath: spot.officialPath || '',
    officialWebUrl: spot.officialWebUrl || '',
    stale: status === 'BOOKABLE',
  };
}

/* ===== 行程规则（镜像 lib/trip.js：TRIP-RULE-003；2026-08-31 取消自动合并 TRIP-RULE-002） ===== */
function buildMockTripName(city, startDate, endDate) {
  const short = (d) => { const p = beijingParts(parseBeijing(d, '12:00')); return `${p.month}.${p.day}`; };
  return `${city} ${short(startDate)}-${short(endDate)}`;
}
/** 行程范围/景点变化后，清掉不再合法的清单项（镜像 timeline.generate 的残留清理） */
function pruneStaleCart(tripId) {
  const trip = db.trips[tripId];
  if (!trip) return;
  Object.keys(db.carts).forEach((id) => {
    const c = db.carts[id];
    if (c.tripId !== tripId) return;
    const spotOk = (trip.spotIds || []).includes(c.spotId);
    const dateOk = c.visitDate >= trip.startDate && c.visitDate <= trip.endDate;
    if (!spotOk || !dateOk) delete db.carts[id];
  });
}

/* ===== 时间线（镜像 lib/timeline.js：TIMELINE-RULE-001~005） ===== */
function difficultyOf(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约' };
  if (score === 3) return { key: 'NORMAL', text: '较难约' };
  return { key: 'EASY', text: '容易约' };
}
function buildEvents(spot, rule, trip) {
  if (!rule || !rule.advanceDays || !rule.releaseTime) return [];
  const events = [];
  for (const visitDate of dateRange(trip.startDate, trip.endDate)) {
    if (!isOpenOn(rule, dayNameOf(visitDate))) continue;
    const releaseDate = addDays(visitDate, -rule.advanceDays);
    events.push({
      spotId: spot.spotId,
      spotName: spot.name,
      difficulty: difficultyOf(spot.difficultyScore),
      visitDate,
      releaseAt: parseBeijing(releaseDate, rule.releaseTime),
      releaseDateStr: releaseDate,
      releaseTimeStr: rule.releaseTime,
      visitDateLabel: formatMonthDayWeek(visitDate),
      advanceDays: rule.advanceDays,
      officialAppid: spot.officialAppid || '',
      officialPath: spot.officialPath || '',
      officialWebUrl: spot.officialWebUrl || '',
    });
  }
  return events;
}
function resolveStatus(event, ctx, nowTs = new Date()) {
  const { inCart = false, task = null } = ctx || {};
  if (event.releaseAt.getTime() > nowTs.getTime()) {
    if (task) return task.backendStatus === 'WAITING' ? 'WAITING' : 'REMINDERED';
    if (inCart) return 'IN_CART';
    return 'SELECTABLE';
  }
  return 'BOOKABLE';
}
function buttonOf(status) {
  switch (status) {
    case 'SELECTABLE': return { text: '+ 添加提醒', enabled: true };
    case 'IN_CART': return { text: '已加清单', enabled: true, openCart: true };
    case 'WAITING': return { text: '待提醒', enabled: false };
    case 'REMINDERED': return { text: '已提醒', enabled: false };
    case 'BOOKABLE': return { text: '立即预约', enabled: true, booking: true };
    case 'FULL': return { text: '已约满', enabled: false };
    default: return { text: '', enabled: false };
  }
}
function defaultScrollIndex(events, nowTs = new Date()) {
  const sorted = [...events].sort((a, b) => a.releaseAt - b.releaseAt);
  const idx = sorted.findIndex(e => e.releaseAt.getTime() > nowTs.getTime());
  return idx === -1 ? Math.max(0, sorted.length - 1) : idx;
}
function groupByDeparture(events, nowTs) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.visitDate)) map.set(e.visitDate, []);
    map.get(e.visitDate).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([visitDate, list]) => {
      const sorted = list.sort((a, b) => a.releaseAt - b.releaseAt);
      return { key: visitDate, label: formatMonthDayWeek(visitDate), events: sorted, count: sorted.length, scrollIndex: defaultScrollIndex(sorted, nowTs) };
    });
}
function groupBySpot(events, nowTs) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.spotId)) map.set(e.spotId, []);
    map.get(e.spotId).push(e);
  }
  return [...map.entries()].map(([spotId, list]) => {
    const sorted = list.sort((a, b) => a.releaseAt - b.releaseAt);
    return { key: spotId, label: sorted[0].spotName, events: sorted, count: sorted.length, scrollIndex: defaultScrollIndex(sorted, nowTs) };
  }).sort((a, b) => a.events[0].releaseAt - b.events[0].releaseAt);
}
function generateTimeline(tripId) {
  const trip = db.trips[tripId];
  if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
  const spotIds = trip.spotIds || [];
  if (spotIds.length === 0) {
    return { success: true, tripId, events: [], byDeparture: [], bySpot: [], closedSpots: [], empty: true, emptyReason: '先选择想去的景点' };
  }
  const nowTs = new Date();
  const events = [];
  const closedSpots = [];
  const closedDaySkips = [];
  for (const spotId of spotIds) {
    const spot = SPOTS.find(s => s.spotId === spotId);
    if (!spot) continue;
    if (spot.reservationRequired === false) continue;
    const rule = RULES.find(r => r.spotId === spotId) || null;
    const built = buildEvents(spot, rule, trip);
    if (built.length === 0) {
      if (!rule || !rule.advanceDays || !rule.releaseTime) {
        closedSpots.push({ spotId, spotName: spot.name, note: '无固定放票时刻，暂不生成提醒' });
      } else {
        closedSpots.push({ spotId, spotName: spot.name, note: (rule.openDays || []).length > 0 ? '行程期间不可约' : '行程期间闭馆' });
      }
      continue;
    }
    // 与云端 timeline.generate 一致的 closedDaySkips
    const skipped = dateRange(trip.startDate, trip.endDate).filter(d => !isOpenOn(rule, dayNameOf(d)));
    if (skipped.length > 0) {
      const isWhitelist = (rule.openDays || []).length > 0;
      closedDaySkips.push({
        spotId,
        spotName: spot.name,
        note: skipped.map(d => formatMonthDayWeek(d)).join('、') + (isWhitelist ? ' 不可约，已为你跳过' : ' 闭馆，已为你跳过'),
      });
    }
    for (const event of built) {
      const key = `${event.spotId}|${event.visitDate}`;
      const inCart = Object.values(db.carts).some(c => c.tripId === tripId && `${c.spotId}|${c.visitDate}` === key);
      const task = Object.values(db.tasks).find(t => t.tripId === tripId && `${t.spotId}|${t.visitDate}` === key) || null;
      const status = resolveStatus(event, { inCart, task }, nowTs);
      events.push({ ...event, status, button: buttonOf(status), stale: event.releaseAt.getTime() <= nowTs.getTime() });
    }
  }
  const validKeys = new Set(events.map(e => `${e.spotId}|${e.visitDate}`));
  Object.keys(db.carts).forEach((id) => {
    const c = db.carts[id];
    if (c.tripId === tripId && !validKeys.has(`${c.spotId}|${c.visitDate}`)) delete db.carts[id];
  });
  events.sort((a, b) => a.releaseAt - b.releaseAt);
  return {
    success: true,
    tripId,
    trip: { _id: tripId, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, spotIds },
    events,
    byDeparture: groupByDeparture(events, nowTs),
    bySpot: groupBySpot(events, nowTs),
    closedSpots,
    closedDaySkips,
    empty: events.length === 0,
    emptyReason: events.length === 0 ? (closedSpots.length > 0 ? '该行程暂无可提醒的放票时间' : '先选择想去的景点') : null,
  };
}

/* ===== Banner（镜像 lib/task.js buildBanner：REMINDER-RULE-008） ===== */
function buildMockBanner(tasks, nowTs = new Date()) {
  const soon = tasks
    .filter(t => t.backendStatus === 'WAITING')
    .map(t => ({ ...t, releaseAtTs: new Date(t.releaseAt).getTime() }))
    .filter(t => { const diff = t.releaseAtTs - nowTs.getTime(); return diff > 0 && diff <= 3600 * 1000; })
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];
  if (!soon) return null;
  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - nowTs.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  const isToday = toDateStr(releaseAt) === toDateStr(nowTs);
  const isTomorrow = toDateStr(releaseAt) === addDays(toDateStr(nowTs), 1);
  const rp = beijingParts(releaseAt);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${rp.month}月${rp.day}日`);
  const vp = beijingParts(parseBeijing(soon.visitDate, '12:00'));
  return {
    type: 'UPCOMING',
    text: `${dayWord}${formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${vp.month}月${vp.day}日的门票，还有${minutesLeft}分钟`,
    taskId: soon._id,
    minutesLeft,
  };
}

/* ===== 无感登录（2026-08-24 重构：进小程序即自动建号，镜像 reminder user.profile） ===== */
function genAutoProfile() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return {
    nickname: '用户' + s,
    avatarUrl: '/images/avatars/default-' + (1 + Math.floor(Math.random() * 6)) + '.png',
  };
}
const mockUser = { openId: 'mock-user', ...genAutoProfile(), phone: '', memberLevel: 'NORMAL', points: 0, subscribeQuota: 0, subscribeQuotas: {}, notifyPrefs: { officialAccount: false, sms: false, offsets: [5, 2] } };

const handlers = {
  /* ----- spots ----- */
  'list': () => ({ success: true, data: SPOTS.map(s => buildCard(s)).sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0)) }),
  'detail': (data) => {
    const spot = SPOTS.find(s => s.spotId === data.spotId);
    if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
    const entries = [];
    if (spot.officialAppid) entries.push({ type: 'MINIPROGRAM', label: '官方小程序', appid: spot.officialAppid, path: spot.officialPath || '', url: spot.officialWebUrl || '', hint: '点击直接跳转官方小程序预约' });
    if (spot.officialAccount) entries.push({ type: 'OFFICIAL_ACCOUNT', label: '微信公众号', value: spot.officialAccount, qrCode: spot.qrCode || '', hint: '点击参与预约 → 填写信息 → 预约成功' });
    if (spot.officialWebUrl) entries.push({ type: 'WEB', label: '景区官网', url: spot.officialWebUrl, hint: '点击预约入口 → 扫小程序码' });
    const rule = RULES.find(r => r.spotId === data.spotId) || {};
    return { success: true, data: { ...buildCard(spot), address: spot.address || spot.district, location: null, entries, bookingTips: rule.bookingTips || '', specialNotice: activeNoticeOf(rule), openTime: rule.openTime || '', ticketPrice: rule.ticketPrice || '', idRequirement: rule.idRequirement || '', ageLimit: rule.ageLimit || '', closedDaysLabel: closedDaysLabel(rule.closedDays, rule.openDays, rule.closedDaysNote), closedDaysNote: (rule.closedDaysNote && (((rule.openDays || []).length > 0) || ((rule.closedDays || []).length > 0))) ? rule.closedDaysNote : '' } };
  },
  'batch': (data) => ({ success: true, data: SPOTS.filter(s => (data.spotIds || []).includes(s.spotId)).map(buildCard) }),
  'search': (data) => {
    const kw = String(data.keyword || '').trim().toLowerCase();
    if (!kw) return { success: true, data: [] };
    const hits = SPOTS.filter(s => s.name.toLowerCase().includes(kw) || s.spotId.includes(kw) || (s.aliases || []).some(a => String(a).toLowerCase().includes(kw))).map(buildCard).sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
    db.searchHistory = [data.keyword, ...db.searchHistory.filter(k => k !== data.keyword)].slice(0, 10);
    return { success: true, data: hits };
  },
  'searchHistory': () => ({ success: true, data: db.searchHistory }),
  'clearSearchHistory': () => { db.searchHistory = []; return { success: true, removed: 0 }; },

  /* ----- trip ----- */
  'trip.create': (data) => {
    /* 2026-08-31 取消自动合并（与云函数 trip.create 一致）：严格按本次输入的日期与景点创建独立行程 */
    const city = data.city || '北京';
    const tripId = 'mock-trip-' + (++tripSeq);
    db.trips[tripId] = {
      _id: tripId, city,
      startDate: data.startDate, endDate: data.endDate,
      spotIds: data.spotIds || [],
      name: buildMockTripName(city, data.startDate, data.endDate),
      status: 'ACTIVE',
    };
    return { success: true, tripId, merged: false, mergedFrom: [], trip: db.trips[tripId] };
  },
  'trip.list': () => {
    /* TRIP-RULE-004 读取时兜底：任务与清单皆空的孤儿行程自动删除（同步云函数） */
    const kept = Object.values(db.trips).filter(t => {
      const hasTask = Object.values(db.tasks).some(x => x.tripId === t._id);
      const hasCart = Object.values(db.carts).some(c => c.tripId === t._id);
      if (hasTask || hasCart) return true;
      delete db.trips[t._id];
      return false;
    });
    const sorted = kept.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    return { success: true, trips: sorted, showGroupTabs: sorted.length >= 2 };
  },
  'trip.updateSpots': (data) => {
    const trip = db.trips[data.tripId];
    if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
    trip.spotIds = data.spotIds || [];
    pruneStaleCart(data.tripId);
    return { success: true, tripId: data.tripId, spotIds: trip.spotIds };
  },
  'trip.updateRange': (data) => {
    const trip = db.trips[data.tripId];
    if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
    trip.startDate = data.startDate;
    trip.endDate = data.endDate;
    trip.name = buildMockTripName(trip.city, data.startDate, data.endDate);
    pruneStaleCart(data.tripId);
    return { success: true, tripId: data.tripId, startDate: trip.startDate, endDate: trip.endDate };
  },

  /* ----- timeline ----- */
  'timeline.generate': (data) => generateTimeline(data.tripId),

  /* ----- cart ----- */
  'cart.add': (data) => {
    const exists = Object.values(db.carts).some(c => c.tripId === data.tripId && c.spotId === data.spotId && c.visitDate === data.visitDate);
    if (exists) return { success: false, error: '这条提醒已经在清单里啦', errorCode: 1002 };
    const cartId = 'mock-cart-' + (++cartSeq);
    db.carts[cartId] = { _id: cartId, tripId: data.tripId, spotId: data.spotId, visitDate: data.visitDate, releaseAt: data.releaseAt };
    return { success: true, cartId };
  },
  'cart.addAll': (data) => {
    const tl = generateTimeline(data.tripId);
    const inScope = data.scope === 'departure' ? (e => e.visitDate === data.scopeKey) : (e => e.spotId === data.scopeKey);
    let added = 0;
    tl.events.filter(e => e.status === 'SELECTABLE' && inScope(e)).forEach(e => {
      const cartId = 'mock-cart-' + (++cartSeq);
      db.carts[cartId] = { _id: cartId, tripId: data.tripId, spotId: e.spotId, visitDate: e.visitDate, releaseAt: e.releaseAt };
      added += 1;
    });
    return { success: true, added, skipped: [], total: added, scope: data.scope, scopeKey: data.scopeKey };
  },
  'cart.remove': (data) => { delete db.carts[data.cartId]; return { success: true, cartId: data.cartId }; },
  'cart.clear': (data) => { Object.keys(db.carts).forEach(id => { if (!data.tripId || db.carts[id].tripId === data.tripId) delete db.carts[id]; }); return { success: true, removed: 0 }; },
  'cart.list': (data) => {
    const items = Object.values(db.carts).filter(c => !data.tripId || c.tripId === data.tripId);
    const now = new Date();
    const enriched = items.map(c => {
      const spot = SPOTS.find(s => s.spotId === c.spotId);
      const releaseAt = new Date(c.releaseAt);
      const msLeft = releaseAt.getTime() - now.getTime();
      const expired = msLeft <= 0;
      const h = Math.max(0, Math.floor(msLeft / 3600000));
      const m = Math.max(0, Math.floor((msLeft % 3600000) / 60000));
      return {
        ...c,
        spotName: spot ? spot.name : '未知景点',
        releaseTimeLabel: formatHourMinute(releaseAt),
        visitDateLabel: '约 ' + formatMonthDayWeek(c.visitDate) + ' 门票',
        countdown: expired
          ? { hours: 0, minutes: 0, text: '', urgent: false, expired: true }
          : { hours: h, minutes: m, text: '还剩' + h + 'h ' + m + 'm', urgent: msLeft < 3600000, expired: false },
      };
    });
    const map = {};
    enriched.forEach(c => { const ds = String(c.releaseAt || '').slice(0, 10); (map[ds] = map[ds] || []).push(c); });
    const groups = Object.keys(map).sort().map(k => ({ key: k, label: formatMonthDay(k), items: map[k].sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)) }));
    const spotCount = new Set(items.map(c => c.spotId)).size;
    const summary = { count: items.length, spotCount, text: `已选 ${items.length} 项，覆盖 ${spotCount} 个景点` };
    return { success: true, items: enriched, groups, summary };
  },

  /* ----- task ----- */
  'task.submit': (data) => {
    const cartItems = Object.values(db.carts).filter(c => !data.tripId || c.tripId === data.tripId);
    if (cartItems.length === 0) return { success: false, error: '先添加至少一条提醒', errorCode: 1009 };
    let created = 0;
    cartItems.forEach(c => {
      const taskId = 'mock-task-' + (++taskSeq);
      db.tasks[taskId] = { _id: taskId, tripId: c.tripId, spotId: c.spotId, visitDate: c.visitDate, releaseAt: c.releaseAt, offsets: data.offsets, channels: data.channels, backendStatus: 'WAITING' };
      delete db.carts[c._id];
      created += 1;
    });
    return { success: true, created, needsOaAuth: (data.channels || []).includes('OFFICIAL_ACCOUNT') };
  },
  'task.list': (data) => {
    let all = Object.values(db.tasks);
    if (data.tripId) all = all.filter(t => t.tripId === data.tripId);
    const now = new Date();
    const enriched = all.map(t => {
      const spot = SPOTS.find(s => s.spotId === t.spotId);
      const releaseAt = new Date(t.releaseAt);
      const msLeft = releaseAt.getTime() - now.getTime();
      const expired = msLeft <= 0;
      return {
        ...t, spotName: spot ? spot.name : '未知景点', difficultyScore: spot ? spot.difficultyScore : null,
        releaseTimeLabel: formatHourMinute(releaseAt), releaseDateStr: fmt(releaseAt),
        grabLabel: `开抢${formatMonthDayWeekCn(t.visitDate)}门票`, statusLabel: '待提醒',
        countdown: msLeft > 0 && msLeft < 3 * 3600000 ? { text: `还剩${pad(Math.floor(msLeft / 3600000))}h ${pad(Math.floor((msLeft % 3600000) / 60000))}m`, urgent: true } : null,
        expired,
      };
    });
    const active = enriched.filter(t => !t.expired);
    const past = enriched.filter(t => t.expired);
    const shown = data.filter === 'expired' ? past : active;
    const map = {};
    shown.forEach(t => { (map[t.releaseDateStr] = map[t.releaseDateStr] || []).push(t); });
    const groups = Object.keys(map).sort((a, b) => data.filter === 'expired' ? b.localeCompare(a) : a.localeCompare(b)).map(k => ({ key: k, label: formatMonthDay(k), items: map[k].sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)) }));
    return { success: true, groups, counts: { active: active.length, expired: past.length }, banner: buildMockBanner(enriched, now), homeMode: enriched.length === 0 ? 1 : 2 };
  },
  'task.remove': (data) => { const t = db.tasks[data.taskId]; delete db.tasks[data.taskId]; return { success: true, taskId: data.taskId, tripId: t ? t.tripId : null, tripRemoved: false }; },
  'task.clear': (data) => {
    let targets = Object.values(db.tasks);
    if (data && data.tripId) targets = targets.filter(t => t.tripId === data.tripId);
    if (data && data.filter) {
      const now = new Date();
      targets = targets.filter(t => {
        const msLeft = new Date(t.releaseAt).getTime() - now.getTime();
        const expired = msLeft <= 0;
        return data.filter === 'expired' ? expired : !expired;
      });
    }
    const affectedTripIds = [...new Set(targets.map(t => t.tripId).filter(Boolean))];
    targets.forEach(t => { delete db.tasks[t._id]; });
    /* TRIP-RULE-004 级联：行程内任务与清单均空则删除行程（同步云函数） */
    affectedTripIds.forEach(tid => {
      const hasTask = Object.values(db.tasks).some(t => t.tripId === tid);
      const hasCart = Object.values(db.carts).some(c => c.tripId === tid);
      if (!hasTask && !hasCart) delete db.trips[tid];
    });
    return { success: true, cleared: targets.length };
  },

  /* ----- user ----- */
  'user.profile': () => ({ success: true, user: { ...mockUser, subscribeQuota: subscribeSeq } }),
  'user.updateProfile': (data) => {
    const nickname = (data.nickname || '').trim().slice(0, 32);
    if (!nickname) return { success: false, error: '昵称不能为空', errorCode: 1010 };
    mockUser.nickname = nickname;
    if (typeof data.avatarUrl === 'string') mockUser.avatarUrl = data.avatarUrl;
    if (typeof data.phone === 'string') {
      const phone = data.phone.trim();
      if (phone && !/^1[3-9]\d{9}$/.test(phone)) return { success: false, error: '手机号格式不正确', errorCode: 1010 };
      mockUser.phone = phone;
    }
    return { success: true, user: { ...mockUser, subscribeQuota: subscribeSeq } };
  },
  'user.updateNotifyPrefs': (data) => {
    mockUser.notifyPrefs = data.notifyPrefs;
    return { success: true, notifyPrefs: data.notifyPrefs };
  },

  /* ----- 订阅消息额度（一次性订阅，按模板记账） ----- */
  'subscribe.add': (data) => {
    const tpl = data.templateId || 'mock-template';
    subscribeQuotas[tpl] = (subscribeQuotas[tpl] || 0) + 1;
    subscribeSeq = Object.values(subscribeQuotas).reduce((sum, n) => sum + n, 0);
    mockUser.subscribeQuota = subscribeSeq;
    mockUser.subscribeQuotas = subscribeQuotas;
    return { success: true, quota: subscribeQuotas[tpl], totalQuota: subscribeSeq, quotas: subscribeQuotas, templateId: tpl };
  },
  'subscribe.get': (data) => {
    const tpl = data.templateId || 'mock-template';
    return { success: true, quota: subscribeQuotas[tpl] || 0, totalQuota: subscribeSeq, quotas: subscribeQuotas, templateId: tpl };
  },

  /* ----- feedback（意见反馈 / 信息纠错，与 cloudfunctions/feedback/lib/schema.js 对齐） ----- */
  'feedback.submit': (data) => {
    const type = data.type;
    if (type !== 'feedback' && type !== 'correction') return { success: false, error: '类型不合法', errorCode: 1010 };
    if (!data.content || !String(data.content).trim()) return { success: false, error: '内容不能为空', errorCode: 1020 };
    if (type === 'feedback') {
      if (!['suggestion', 'bug'].includes(data.category)) return { success: false, error: '反馈类型不合法', errorCode: 1010 };
    } else {
      if (!data.spotId) return { success: false, error: '请选择景点', errorCode: 1010 };
      if (!['RELEASE_TIME', 'RELEASE_RULE', 'OPEN_TIME', 'TICKET_PRICE', 'ADDRESS', 'CLOSED_DAYS', 'OTHER'].includes(data.errorType)) return { success: false, error: '纠错类型不合法', errorCode: 1010 };
    }
    const isCorrection = type === 'correction';
    const id = 'mock-feedback-' + (++feedbackSeq);
    db.feedbacks[id] = {
      _id: id, userId: 'mock-user', type,
      category: isCorrection ? null : data.category,
      spotId: isCorrection ? data.spotId : null,
      spotName: isCorrection ? (data.spotName || '') : null,
      errorType: isCorrection ? data.errorType : null,
      content: String(data.content).trim(),
      contact: (data.contact || '').trim(),
      status: 'OPEN',
      createdAt: new Date(),
    };
    return { success: true, id };
  },
  'feedback.list': () => ({
    success: true,
    items: Object.values(db.feedbacks).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  }),

  /* 首页聚合（镜像云端 reminder homeBootstrap）：复用各域 handler 组合返回，供 USE_MOCK=true 时首页使用 */
  'home.bootstrap': (data) => {
    const filter = data.filter || 'active';
    const activeTripTab = data.activeTripTab || '';
    const tripId = data.tripId || '';
    const includeSpots = data.includeSpots !== false;
    const tasksAll = handlers['task.list']({ tripId: null, filter });
    const trips = handlers['trip.list']();
    const tripTasks = activeTripTab ? handlers['task.list']({ tripId: activeTripTab, filter }) : null;
    const cart = tripId ? handlers['cart.list']({ tripId }) : null;
    const hotSpots = includeSpots ? handlers['list']().data : [];
    return {
      success: true,
      homeMode: tasksAll.homeMode || 1,
      groups: tasksAll.groups || [],
      counts: tasksAll.counts || { active: 0, expired: 0 },
      banner: tasksAll.banner || null,
      tripTasks: tripTasks && tripTasks.success ? tripTasks : null,
      trips: (trips && trips.trips) || [],
      showGroupTabs: (trips && trips.showGroupTabs) || false,
      cart,
      hotSpots,
    };
  },

};

function mockCall(name, data) {
  const action = (data && data.action) || name;
  const h = handlers[action];
  if (!h) return Promise.reject({ success: false, error: 'mock 未实现: ' + name + '.' + action, errorCode: 1099 });
  try {
    return Promise.resolve(h(data || {})).then(res => {
      /* 错误约定统一：mock 与云函数一致，校验失败一律 reject（页面只写 catch → toastError 一套错误处理） */
      if (res && res.success === false) return Promise.reject(res);
      return res;
    });
  } catch (e) {
    return Promise.reject({ success: false, error: e.message, errorCode: 1500 });
  }
}

/* 供页面 fallback 使用：单一数据源，避免各页本地 MOCK 漂移 */
function spotsListCards() { return SPOTS.map(buildCard); }

module.exports = { mockCall, USE_MOCK, SPOTS, spotsListCards };
