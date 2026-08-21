/**
 * Mock 后端 -- 测试号不支持云开发时的内存模拟
 *
 * 联调正式 appid 时：把 USE_MOCK 改成 false，走真实云函数（utils/api.js 自动切换）。
 * 内存数据在小程序一次运行内连贯，重新编译会重置。
 */

const USE_MOCK = false;

/* ===== 景点数据（spotId 与 images/spots/*.jpg 对齐） ===== */
const SPOTS = [
  { spotId: 'gugong', name: '故宫博物院', category: '博物馆', district: '东城区', address: '景山前街4号', difficultyScore: 5, popularityScore: 5, reservationRequired: true, advanceDays: 7, releaseTime: '20:00', closedDays: ['monday'], officialAccount: '故宫博物院', qrCode: '/images/qrcodes/gugong.png', officialAppid: 'wx8f815c1df1f067ef', officialPath: 'pages/index/index', officialWebUrl: 'https://www.dpm.org.cn', hasWebVersion: true, scrapingUrl: 'https://www.dpm.org.cn/Home.html' },
  { spotId: 'tiananmen-chenglou', name: '天安门城楼', category: '古迹', district: '东城区', address: '天安门广场北侧', difficultyScore: 5, popularityScore: 5, reservationRequired: true, advanceDays: 7, releaseTime: '17:00', closedDays: ['monday'], officialAccount: '天安门城楼参观预约', qrCode: '', officialAppid: '', officialPath: '', officialWebUrl: 'https://www.tiananmenchenglou.com', hasWebVersion: true, scrapingUrl: 'https://www.tiananmenchenglou.com' },
  { spotId: 'guobo', name: '中国国家博物馆', category: '博物馆', district: '东城区', address: '东长安街16号', difficultyScore: 5, popularityScore: 5, reservationRequired: true, advanceDays: 7, releaseTime: '17:00', closedDays: ['monday'], officialAccount: '中国国家博物馆', qrCode: '/images/qrcodes/guobo.png', officialAppid: 'wxee20f5f652c82948', officialPath: 'pages/index/index', officialWebUrl: 'https://www.chnmuseum.cn', hasWebVersion: true, scrapingUrl: 'https://www.chnmuseum.cn' },
  { spotId: 'yiheyuan', name: '颐和园', category: '公园', district: '海淀区', address: '新建宫门路19号', difficultyScore: 1, popularityScore: 5, reservationRequired: false, advanceDays: 7, releaseTime: '21:00', closedDays: [], officialAccount: '畅游公园', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.summerpalace-china.com', hasWebVersion: true, scrapingUrl: 'https://www.summerpalace-china.com' },
  { spotId: 'tiantan', name: '天坛公园', category: '公园', district: '东城区', address: '天坛东里甲1号', difficultyScore: 1, popularityScore: 4, reservationRequired: false, advanceDays: 7, releaseTime: '21:00', closedDays: ['monday'], officialAccount: '畅游公园', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.tiantanpark.com', hasWebVersion: true, scrapingUrl: 'https://www.tiantanpark.com' },
  { spotId: 'badaling', name: '八达岭长城', category: '古迹', district: '延庆区', address: 'G6京藏高速58号出口', difficultyScore: 1, popularityScore: 5, reservationRequired: true, advanceDays: 10, releaseTime: '00:00', closedDays: [], officialAccount: '八达岭长城', qrCode: '', officialAppid: 'wx510a0ad3c35a2fdc', officialPath: 'pages/index/index', officialWebUrl: 'https://www.badaling.cn', hasWebVersion: true, scrapingUrl: 'https://www.badaling.cn' },
  { spotId: 'yuanmingyuan', name: '圆明园遗址公园', category: '公园', district: '海淀区', address: '清华西路28号', difficultyScore: 1, popularityScore: 4, reservationRequired: false, advanceDays: 7, releaseTime: '00:00', closedDays: [], officialAccount: '畅游公园', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.yuanmingyuanpark.com', hasWebVersion: true, scrapingUrl: 'https://www.yuanmingyuanpark.com' },
  { spotId: 'beijing-zoo', name: '北京动物园', category: '公园', district: '西城区', address: '西直门外大街137号', difficultyScore: 1, popularityScore: 4, reservationRequired: false, advanceDays: 7, releaseTime: '00:00', closedDays: [], officialAccount: '畅游公园', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.beijingzoo.com', hasWebVersion: true, scrapingUrl: 'https://www.beijingzoo.com' },
  { spotId: 'gongwangfu', name: '恭王府', category: '古迹', district: '西城区', address: '前海西街17号', difficultyScore: 1, popularityScore: 3, reservationRequired: true, advanceDays: 7, releaseTime: '00:00', closedDays: ['monday'], officialAccount: '恭王府博物馆', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.pgm.org.cn', hasWebVersion: true, scrapingUrl: 'https://www.pgm.org.cn' },
  { spotId: 'beihai', name: '北海公园', category: '公园', district: '西城区', address: '文津街1号', difficultyScore: 1, popularityScore: 3, reservationRequired: false, advanceDays: 7, releaseTime: '00:00', closedDays: ['monday'], officialAccount: '畅游公园', qrCode: '', officialAppid: 'wx5d0054631919f154', officialPath: 'pages/home/home', officialWebUrl: 'https://www.beihaipark.com.cn', hasWebVersion: true, scrapingUrl: 'https://www.beihaipark.com.cn' },
  { spotId: 'tiananmen-square', name: '天安门广场', category: '广场', district: '东城区', address: '东长安街天安门广场', difficultyScore: 5, popularityScore: 5, reservationRequired: true, aliases: ['升旗', '天安门升旗', '看升旗'], advanceDays: 7, releaseTime: '12:00', closedDays: [], officialAccount: '天安门广场预约参观', qrCode: '', officialAppid: 'wx784eb46174db6aed', officialPath: '', officialWebUrl: 'http://yuyue.tamgw.beijing.gov.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'maozhuxi-jiniantang', name: '毛主席纪念堂', category: '纪念场馆', district: '东城区', address: '天安门广场人民英雄纪念碑南侧', difficultyScore: 4, popularityScore: 4, reservationRequired: true, aliases: ['纪念堂'], advanceDays: 6, releaseTime: '12:30', closedDays: ['monday'], officialAccount: '毛主席纪念堂', qrCode: '', officialAppid: 'wx492b5d2f5b89c11e', officialPath: '', officialWebUrl: 'https://cpc.people.com.cn/GB/143527/143528/', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'renmin-dahuitang', name: '人民大会堂', category: '场馆', district: '西城区', address: '西长安街天安门广场西侧', difficultyScore: 4, popularityScore: 4, reservationRequired: true, aliases: ['大会堂'], advanceDays: 3, releaseTime: '17:00', closedDays: ['monday'], officialAccount: '人民大会堂参观预约', qrCode: '', officialAppid: 'wxb2809a187df8351b', officialPath: '', officialWebUrl: '', hasWebVersion: false, scrapingUrl: '' },
  { spotId: 'junbo', name: '中国人民革命军事博物馆', category: '博物馆', district: '海淀区', address: '复兴路9号', difficultyScore: 4, popularityScore: 5, reservationRequired: true, aliases: ['军博', '军事博物馆'], advanceDays: 8, releaseTime: '09:00', releaseTimes: ['09:00', '17:00'], closedDays: ['monday'], officialAccount: '中国人民革命军事博物馆', qrCode: '', officialAppid: 'wxe7ab4bac193578d0', officialPath: '', officialWebUrl: 'https://www.junbo.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'ziran-bowuguan', name: '国家自然博物馆', category: '博物馆', district: '东城区', address: '天桥南大街126号', difficultyScore: 5, popularityScore: 4, reservationRequired: true, aliases: ['自然博物馆', '自然博'], advanceDays: 3, releaseTime: '11:00', closedDays: ['monday'], officialAccount: '北京自然博物馆', qrCode: '', officialAppid: 'wx3ccbf39dedcfc335', officialPath: '', officialWebUrl: 'https://www.bmnh.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'kaogu-bowuguan', name: '中国考古博物馆', category: '博物馆', district: '朝阳区', address: '国家体育场北路1号院1号楼', difficultyScore: 5, popularityScore: 4, reservationRequired: true, aliases: ['考古博物馆', '考古博'], advanceDays: 3, releaseTime: '09:00', closedDays: ['monday', 'tuesday'], officialAccount: '中国考古博物馆', qrCode: '', officialAppid: 'wx48b5cc9990544897', officialPath: '', officialWebUrl: '', hasWebVersion: false, scrapingUrl: '' },
  { spotId: 'tsinghua', name: '清华大学', category: '高校', district: '海淀区', address: '清华园1号', difficultyScore: 4, popularityScore: 4, reservationRequired: true, aliases: ['清华', '清华大学参观'], advanceDays: 7, releaseTime: '08:00', closedDays: [], officialAccount: '清华大学', qrCode: '', officialAppid: 'wxef227a5869ad5e4a', officialPath: '', officialWebUrl: 'https://www.tsinghua.edu.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'peking-university', name: '北京大学', category: '高校', district: '海淀区', address: '颐和园路5号', difficultyScore: 4, popularityScore: 4, reservationRequired: true, aliases: ['北大', '北京大学参观'], advanceDays: 7, releaseTime: '08:00', closedDays: [], officialAccount: '北京大学', qrCode: '', officialAppid: 'wxae221464afae4826', officialPath: '', officialWebUrl: 'https://www.pku.edu.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'kejiguan', name: '中国科技馆', category: '博物馆', district: '朝阳区', address: '北辰东路5号', difficultyScore: 3, popularityScore: 4, reservationRequired: true, aliases: ['科技馆', '中国科学技术馆'], advanceDays: 7, releaseTime: '18:00', closedDays: ['monday'], officialAccount: '中国科学技术馆', qrCode: '', officialAppid: 'wx2c0837274f1a69e1', officialPath: '', officialWebUrl: 'https://www.cstm.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'meishuguan', name: '中国美术馆', category: '博物馆', district: '东城区', address: '五四大街1号', difficultyScore: 3, popularityScore: 4, reservationRequired: true, aliases: ['美术馆'], advanceDays: 7, releaseTime: '16:00', closedDays: ['monday'], officialAccount: '中国美术馆', qrCode: '/images/qrcodes/meishuguan.png', officialAppid: 'wx7988edf272d3bc05', officialPath: '', officialWebUrl: 'https://www.namoc.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'gongyi-meishuguan', name: '中国工艺美术馆·非遗馆', category: '博物馆', district: '朝阳区', address: '湖景东路16号', difficultyScore: 2, popularityScore: 3, reservationRequired: true, aliases: ['工艺美术馆', '非遗馆', '工美馆'], advanceDays: 7, releaseTime: '00:00', closedDays: ['monday'], officialAccount: '中国工美馆 中国非遗馆', qrCode: '/images/qrcodes/gongyi-meishuguan.png', officialAppid: '', officialPath: '', officialWebUrl: 'https://www.gmfyg.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'shoubo', name: '首都博物馆', category: '博物馆', district: '西城区', address: '复兴门外大街16号', difficultyScore: 2, popularityScore: 3, reservationRequired: false, aliases: ['首博'], advanceDays: null, releaseTime: '', closedDays: ['tuesday'], officialAccount: '首都博物馆', qrCode: '', officialAppid: 'wx79ef8066f8c5edcd', officialPath: '', officialWebUrl: 'http://www.capitalmuseum.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'mutianyu', name: '慕田峪长城', category: '古迹', district: '怀柔区', address: '渤海镇慕田峪村', difficultyScore: 2, popularityScore: 4, reservationRequired: true, aliases: ['慕田峪'], advanceDays: 30, releaseTime: '00:00', closedDays: [], officialAccount: '慕田峪长城', qrCode: '', officialAppid: 'wx15e60c04826479ea', officialPath: '', officialWebUrl: 'https://www.mutianyugreatwall.com', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'kongmiao-guozijian', name: '孔庙和国子监博物馆', category: '博物馆', district: '东城区', address: '国子监街15号', difficultyScore: 2, popularityScore: 3, reservationRequired: true, aliases: ['孔庙', '国子监'], advanceDays: 7, releaseTime: '08:00', closedDays: ['monday'], officialAccount: '孔庙和国子监博物馆', qrCode: '', officialAppid: '', officialPath: '', officialWebUrl: 'http://www.kmgzj.com', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'tianwenguan', name: '北京天文馆', category: '博物馆', district: '西城区', address: '西直门外大街138号', difficultyScore: 1, popularityScore: 3, reservationRequired: true, aliases: ['天文馆'], advanceDays: 5, releaseTime: '', closedDays: ['tuesday'], officialAccount: '北京天文馆', qrCode: '/images/qrcodes/tianwenguan.png', officialAppid: '', officialPath: '', officialWebUrl: 'https://www.bjp.org.cn', hasWebVersion: true, scrapingUrl: '' },
  { spotId: 'huanqiu-yingcheng', name: '北京环球影城', category: '主题乐园', district: '通州区', address: '京哈高速与东六环交汇处西北角', difficultyScore: 2, popularityScore: 5, reservationRequired: true, aliases: ['环球影城', '环球度假区'], advanceDays: 7, releaseTime: '00:00', closedDays: [], officialAccount: '北京环球度假区', qrCode: '', officialAppid: 'wx3ba512d53df66a75', officialPath: '', officialWebUrl: 'https://www.universalbeijingresort.com', hasWebVersion: true, scrapingUrl: '' },
];

function difficultyLabel(score) {
  if (score >= 4) return { key: 'EXTREME', text: '极难约' };
  if (score === 3) return { key: 'NORMAL', text: '较难约' };
  return { key: 'EASY', text: '容易约' };
}

const DAY_CN = { monday: '周一', tuesday: '周二', wednesday: '周三', thursday: '周四', friday: '周五', saturday: '周六', sunday: '周日' };
function closedDaysLabel(days) {
  if (!days || days.length === 0) return '全年开放';
  return days.map(d => DAY_CN[d] || d).join('、') + '闭馆';
}

const RULES = [
  { spotId: 'gugong', specialNotice: '【临时公告】故宫博物院2026年8月15日至8月17日因设备检修，珍宝馆及钟表馆暂停开放，其余区域正常参观', bookingTips: '每个证件每个入院日限订1张；分上午场和下午场，上午场最迟12:00检票，下午场最早11:00检票；珍宝馆和钟表馆需另购票', openTime: '08:30-17:00（16:10停止入场），周一闭馆（法定节假日除外）', ticketPrice: '旺季60元/人，淡季40元/人；珍宝馆10元，钟表馆10元', idRequirement: '中国大陆观众凭身份证原件，外籍观众凭护照', ageLimit: '未满18周岁中国公民免费，但需预约；60周岁以上（含）老年人旺季30元，淡季20元' },
  { spotId: 'tiananmen-chenglou', specialNotice: '', bookingTips: '每人每参观日限预约1次；登城楼须安检，建议轻装前往', openTime: '08:30-17:00（16:30停止检票）', ticketPrice: '15元/人', idRequirement: '须持预约时使用的身份证件原件', ageLimit: '18周岁以下、60周岁（含）以上中国公民免费；现役军人、消防救援人员、残疾人凭证件免费' },
  { spotId: 'guobo', specialNotice: '', bookingTips: '每个账号每个参观日限预约5人；入馆须按预约时段，迟到可能无法入馆', openTime: '09:00-17:00（16:00停止入馆），周一闭馆（法定节假日除外）', ticketPrice: '免费', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '未满14周岁未成年人须由成年人陪同参观；军人、残疾人、60岁以上老人凭证件优先' },
  { spotId: 'yiheyuan', specialNotice: '', bookingTips: '联票含德和园、佛香阁、苏州街、文昌院；园中园需二次检票，建议保留联票', openTime: '旺季06:00-20:00（19:00停止入园），淡季06:30-19:00（18:00停止入园）', ticketPrice: '旺季30元/人，淡季20元/人；联票旺季60元，淡季50元', peakPrice: '旺季门票30元，联票60元', offPrice: '淡季门票20元，联票50元', idRequirement: '身份证原件或护照', ageLimit: '6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁（含）以上老年人凭身份证半价' },
  { spotId: 'tiantan', specialNotice: '', bookingTips: '祈年殿等园内景点周一闭馆（法定节假日除外）；公园全天开放，景点需另购联票', openTime: '公园06:00-22:00（21:00停止入园），景点08:00-18:00（17:30停止进入）', ticketPrice: '旺季门票15元，联票34元；淡季门票10元，联票28元', peakPrice: '旺季门票15元，联票34元', offPrice: '淡季门票10元，联票28元', idRequirement: '身份证原件', ageLimit: '18周岁以下未成年人免费；60周岁以上老年人凭身份证免费' },
  { spotId: 'badaling', specialNotice: '', bookingTips: '通过「长城内外旅游」小程序实名预约购票（2026-08 恢复开放公告）；缆车、滑车另行购票；旺季人流量大，建议提前3-7天预约', openTime: '旺季06:30-16:30，淡季07:30-16:00', ticketPrice: '旺季40元/人，淡季35元/人', peakPrice: '旺季门票40元', offPrice: '淡季门票35元', idRequirement: '须持预约时使用的身份证件原件', ageLimit: '未满18周岁中国公民免费；残疾人、现役军人、消防救援人员、60周岁以上老人凭有效证件免费' },
  { spotId: 'yuanmingyuan', specialNotice: '', bookingTips: '建议购买联票参观西洋楼遗址；含大水法遗址、迷宫等景点', openTime: '07:00-19:30（19:00停止售票）', ticketPrice: '大门10元/人，西洋楼遗址15元，联票25元', cardPrice: '大门10元，联票25元', idRequirement: '身份证原件', ageLimit: '未满18周岁未成年人免费；60周岁以上老年人凭老年证或身份证免费' },
  { spotId: 'beijing-zoo', specialNotice: '', bookingTips: '大熊猫馆限流，建议购买联票；熊猫馆高峰时段需排队', openTime: '旺季07:30-18:00，淡季07:30-17:00', ticketPrice: '旺季15元/人，淡季10元/人；联票（含熊猫馆）旺季19元，淡季14元', peakPrice: '旺季门票15元，联票（含熊猫馆）19元', offPrice: '淡季门票10元，联票（含熊猫馆）14元', idRequirement: '身份证原件', ageLimit: '6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证免费' },
  { spotId: 'gongwangfu', specialNotice: '', bookingTips: '需预约但票源充足，基本每天都能约到；官方渠道「恭王府博物馆」公众号；每个证件每日限购1张；建议跟随讲解游览', openTime: '08:30-17:00（16:10停止检票），周一闭馆（法定节假日除外）', ticketPrice: '40元/人', cardPrice: '40元/人', idRequirement: '须持预约时使用的身份证件原件', ageLimit: '6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证半价（20元）' },
  { spotId: 'beihai', specialNotice: '', bookingTips: '琼华岛等园内景点周一闭馆（法定节假日除外）；白塔位于琼华岛山顶', openTime: '旺季06:00-21:00（20:30停止入园），淡季06:30-20:00（19:30停止入园）', ticketPrice: '旺季门票10元，联票20元；淡季门票5元，联票15元', peakPrice: '旺季门票10元，联票20元', offPrice: '淡季门票5元，联票15元', idRequirement: '身份证原件', ageLimit: '6周岁（含）以下或身高1.2米（含）以下儿童免费；60周岁以上老年人凭身份证免费' },
  { spotId: 'tiananmen-square', specialNotice: '', bookingTips: '可提前1-7天预约，每日12:00分批更新可预约票量，分升旗/上午/下午/降旗时段；观看升旗须单独预约升旗时段；节假日和暑期放票后几分钟即约满，建议设闹钟卡点', openTime: '升旗时段以官方当日公示为准；广场开放约 05:00-22:00（以官方为准）', ticketPrice: '免费', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '全员实名预约，无免约通道' },
  { spotId: 'maozhuxi-jiniantang', specialNotice: '', bookingTips: '提前1-6天预约，每日12:30放票（12:38、12:50固定补放）；每账号最多约5人；严禁携带电子设备，须安检；当天不可约', openTime: '08:00-12:00（仅上午瞻仰，以官方公示为准）', ticketPrice: '免费', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '全员实名预约，无免约通道' },
  { spotId: 'renmin-dahuitang', specialNotice: '', bookingTips: '提前1-3天预约，每日17:00放票；须按预约时段参观，携带身份证原件', openTime: '09:00-16:30（16:00停止检票），周一闭馆（以官方为准）', ticketPrice: '30元/人', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '以官方公示为准' },
  { spotId: 'junbo', specialNotice: '', bookingTips: '每日 9:00、17:00 两个放票时段（官方暑期安排，释放次日参观票）；提前8天可约；卡点进入，约不上别退出持续刷新；人数多可分时段分批约', openTime: '09:00-17:00（16:00停止入馆），周一闭馆', ticketPrice: '免费', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '未满14周岁未成年人须由成年人陪同（以官方为准）' },
  { spotId: 'ziran-bowuguan', specialNotice: '', bookingTips: '提前3天放票，每日11:00开抢；周末票比国博还难抢（场馆小票少），放票后几分钟约满；建议提前录好同行人信息、定闹钟卡点', openTime: '09:00-17:00（16:00停止入馆），周一闭馆', ticketPrice: '免费（收费临展另购）', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '儿童无论年龄均需单独预约（以官方为准）' },
  { spotId: 'kaogu-bowuguan', specialNotice: '', bookingTips: '每日限量约500-2000张，提前3天9:00放票，周末秒空；周二仅接受团体预约，散客无法入内；放票后建议持续刷新', openTime: '09:00-16:30（16:00停止检票）；周一闭馆，周二仅团体', ticketPrice: '免费', idRequirement: '须持预约时使用的有效身份证件原件', ageLimit: '以官方公示为准' },
  { spotId: 'tsinghua', specialNotice: '', bookingTips: '通过「参观清华」小程序实名预约，双轨制：即时预约每日8:00-17:00（工作日最多提前1天，周末及节假日最多提前7天）；抽签预约每日17:00-21:45（工作日最多提前2天，周末及节假日最多提前8天，22:00公布中签）；每人每180天仅可成功预约1次', openTime: '入校参观时段以「参观清华」小程序为准（暑期约8:00-17:00入校）', ticketPrice: '免费', idRequirement: '实名认证，入校时人证核验', ageLimit: '以官方公示为准' },
  { spotId: 'peking-university', specialNotice: '', bookingTips: '通过「参观北大」小程序实名预约，双轨制：即时预约每日8:00-17:00（最多提前7日）；抽签预约每日17:00-21:45（最多提前8日）；入校时段 8:00-11:00、13:00-16:00，东侧门人证核验入校，当日19:00前离校', openTime: '入校时段 8:00-11:00、13:00-16:00（以官方为准）', ticketPrice: '免费', idRequirement: '实名预约，入校时人证核验', ageLimit: '以官方公示为准' },
  { spotId: 'kejiguan', specialNotice: '', bookingTips: '提前7天约18:00放票（曾为24:00，以官方为准）；主展厅票较充足，球幕/巨幕影院最难约，建议电脑端优先抢影院票', openTime: '09:30-17:00（16:30停止入馆），周一闭馆（以官方为准）', ticketPrice: '主展厅30元/人（以官方为准）；特效影院另购', idRequirement: '实名预约，凭有效身份证件入馆', ageLimit: '以官方公示为准' },
  { spotId: 'meishuguan', specialNotice: '', bookingTips: '提前7日实名预约，每日16:00放票，日限6000人；周末及节假日名额紧张，建议卡点预约', openTime: '09:00-17:00（16:00停止入馆），周一闭馆', ticketPrice: '免费', idRequirement: '实名预约，凭有效身份证件入馆', ageLimit: '以官方公示为准' },
  { spotId: 'gongyi-meishuguan', specialNotice: '', bookingTips: '提前7日实名预约（放票时刻以官方为准）；周末和节假日只接受线上预约', openTime: '09:00-17:00（16:00停止入馆），周一闭馆', ticketPrice: '免费', idRequirement: '实名预约，凭有效身份证件入馆', ageLimit: '70周岁以上老人、现役军人、残障人士可现场协助办理（以官方为准）' },
  { spotId: 'shoubo', specialNotice: '', bookingTips: '2025-12-20 起免预约，携带身份证北侧入口登记入馆（以官方为准）；临展可能需单独购票', openTime: '09:00-20:00（19:00停止入馆），周二闭馆', ticketPrice: '免费（临展另购）', idRequirement: '实名预约，凭有效身份证件入馆', ageLimit: '以官方公示为准' },
  { spotId: 'mutianyu', specialNotice: '', bookingTips: '实名制预约购票，可提前30天（官网口径）；票量充足，旺季建议提前线上购票；缆车/滑道另行购票', openTime: '旺季07:30-17:30，淡季07:30-16:30（以官方为准）', ticketPrice: '旺季45元/人，淡季35元（以官方为准）', idRequirement: '实名购票，刷身份证入园', ageLimit: '18周岁以下、60周岁以上免票（以官方为准）' },
  { spotId: 'kongmiao-guozijian', specialNotice: '', bookingTips: '可提前7天预约，参观日前7天早8:00释放名额；周一闭馆；也可当日现场扫码购票（以官方为准）', openTime: '09:00-17:00（16:30停止入场），周一闭馆', ticketPrice: '30元/人（18周岁以下、60周岁以上免费）', idRequirement: '实名购票，凭身份证/二维码入馆', ageLimit: '18周岁以下、60周岁以上免费（以官方为准）' },
  { spotId: 'tianwenguan', specialNotice: '', bookingTips: '散客票最早可提前5天预约（以官方为准）；官方未明确固定放票时刻，以公众号通知为准；剧场票较抢手，建议提前3-5天购票', openTime: '09:00-16:30（16:00停止入馆），周二闭馆', ticketPrice: '展厅票10元/人（以官方为准）；剧场票另购', idRequirement: '实名购票', ageLimit: '以官方公示为准' },
  { spotId: 'huanqiu-yingcheng', specialNotice: '', bookingTips: '购票型乐园：官方App/小程序购票并预约入园，指定日期票无需二次预约；旺季建议提前7天购票，谨防黄牛', openTime: '以官方App当日公示为准', ticketPrice: '淡季418元起，旺季638-748元（以官方为准）', idRequirement: '实名购票，凭身份证/人脸入园', ageLimit: '以官方公示为准' },
];

/* B 层卡片描述：随到随买，当前{旺季/淡季}门票...（mock 本地时区按北京时间） */
function cardDescOf(rule) {
  if (!rule) return '';
  const month = new Date().getMonth() + 1;
  if (rule.peakPrice || rule.offPrice) {
    const isPeak = month >= 4 && month <= 10; // 北京公园旺季 4-10 月
    const frag = (isPeak ? rule.peakPrice : rule.offPrice) || rule.peakPrice || rule.offPrice;
    return '随到随买，当前' + frag;
  }
  const base = rule.cardPrice || rule.ticketPrice || '';
  return base ? '随到随买，' + base : '';
}

function buildCard(spot) {
  const rule = RULES.find(r => r.spotId === spot.spotId) || {};
  return {
    spotId: spot.spotId, name: spot.name, category: spot.category, district: spot.district,
    difficultyScore: spot.difficultyScore, difficultyLabel: difficultyLabel(spot.difficultyScore),
    popularityScore: spot.popularityScore,
    reservationRequired: spot.reservationRequired !== false,
    cardDesc: cardDescOf(rule),
    tags: (() => {
      const t = [];
      if (spot.advanceDays) t.push(`提前${spot.advanceDays}天放票`);
      const rt = spot.releaseTimes || spot.releaseTime;
      if (rt) t.push(`${Array.isArray(rt) ? rt.join('、') : rt}放票`);
      return t;
    })(),
    advanceDays: spot.advanceDays, releaseTime: spot.releaseTimes || spot.releaseTime, closedDays: spot.closedDays || [],
    ticketPrice: rule.ticketPrice || '', openTime: rule.openTime || '',
    releaseStatus: 'NOT_RELEASED', earliestDate: null,
    officialAppid: spot.officialAppid || '', officialPath: spot.officialPath || '', officialWebUrl: spot.officialWebUrl || '',
    stale: false,
  };
}

/* ===== 时间工具（前端本地时区，模拟器默认北京时间） ===== */
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseBeijing(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return fmt(dt);
}
function diffDays(a, b) { return Math.round((parseBeijing(b) - parseBeijing(a)) / 86400000); }
function dateRange(start, end) {
  const out = []; const n = diffDays(start, end);
  for (let i = 0; i <= n; i += 1) out.push(addDays(start, i));
  return out;
}
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dayNameOf(dateStr) { return DAY_NAMES[parseBeijing(dateStr, '12:00').getDay()]; }
function formatMonthDay(dateStr) {
  const d = parseBeijing(dateStr, '12:00');
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function formatMonthDayWeek(dateStr) {
  const d = parseBeijing(dateStr, '12:00');
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 (周${cn[d.getDay()]})`;
}
function formatMonthDayWeekCn(dateStr) {
  const d = parseBeijing(dateStr, '12:00');
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日（周${cn[d.getDay()]}）`;
}
function formatHourMinute(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }

/* ===== 内存存储 ===== */
const db = { trips: {}, carts: {}, tasks: {}, searchHistory: [], feedbacks: {} };

/** TRIP-RULE-002 合并判定：同城市，且（日期有交集 或 首尾相接） */
function canMergeTrips(a, b) {
  if (a.city !== b.city) return false;
  const DAY = 86400000;
  const t = d => parseBeijing(d, '12:00').getTime();
  const overlap = a.startDate <= b.endDate && b.startDate <= a.endDate;
  if (overlap) return true;
  return t(a.endDate) + DAY === t(b.startDate) || t(b.endDate) + DAY === t(a.startDate);
}

/* TRIP-RULE-003 行程命名 = 城市 + 日期范围（如「北京 5.31-6.4」），与云函数 buildName 一致 */
function buildMockTripName(city, startDate, endDate) {
  const short = dstr => {
    const d = parseBeijing(dstr, '12:00');
    return `${d.getMonth() + 1}.${d.getDate()}`;
  };
  return `${city || '北京'} ${short(startDate)}-${short(endDate)}`;
}

/* REMINDER-RULE-008 Banner 文案（与云函数 buildBanner 同逻辑，1 小时内最近一条） */
function buildMockBanner(tasks, now) {
  const soon = (tasks || [])
    .filter(t => t.backendStatus === 'WAITING')
    .map(t => ({ ...t, releaseAtTs: new Date(t.releaseAt).getTime() }))
    .filter(t => t.releaseAtTs - now.getTime() > 0 && t.releaseAtTs - now.getTime() <= 3600 * 1000)
    .sort((a, b) => a.releaseAtTs - b.releaseAtTs)[0];
  if (!soon) return null;
  const minutesLeft = Math.max(1, Math.round((soon.releaseAtTs - now.getTime()) / 60000));
  const releaseAt = new Date(soon.releaseAt);
  const isToday = fmt(releaseAt) === fmt(now);
  const isTomorrow = fmt(releaseAt) === addDays(fmt(now), 1);
  const dayWord = isToday ? '今天' : (isTomorrow ? '明天' : `${releaseAt.getMonth() + 1}月${releaseAt.getDate()}日`);
  const vp = parseBeijing(soon.visitDate, '12:00');
  const visitLabel = `${vp.getMonth() + 1}月${vp.getDate()}日`;
  return {
    type: 'UPCOMING',
    text: `${dayWord}${formatHourMinute(releaseAt)}开抢${soon.spotName || ''}${visitLabel}的门票，还有${minutesLeft}分钟`,
    taskId: soon._id,
    minutesLeft,
  };
}
let tripSeq = 0, cartSeq = 0, taskSeq = 0, feedbackSeq = 0, subscribeSeq = 0;

/* ===== 时间线生成（简化版后端 timeline.generate） ===== */
function generateTimeline(tripId) {
  const trip = db.trips[tripId];
  if (!trip) return { success: false, error: '行程不存在', errorCode: 1001 };
  const events = [];
  const closedSpots = [];
  const now = new Date();

  for (const spotId of (trip.spotIds || [])) {
    const spot = SPOTS.find(s => s.spotId === spotId);
    if (!spot) continue;
    // B 层免预约景点不进时间线（reservationRequired=false，2026 政策已取消预约）
    if (spot.reservationRequired === false) continue;
    let hasEvent = false;
    for (const visitDate of dateRange(trip.startDate, trip.endDate)) {
      if ((spot.closedDays || []).includes(dayNameOf(visitDate))) continue;
      const releaseDate = addDays(visitDate, -spot.advanceDays);
      const releaseAt = parseBeijing(releaseDate, spot.releaseTime);
      let status, button, stale = false;
      if (releaseAt.getTime() > now.getTime()) {
        const inCart = Object.values(db.carts).some(c => c.tripId === tripId && c.spotId === spotId && c.visitDate === visitDate);
        const hasTask = Object.values(db.tasks).some(t => t.tripId === tripId && t.spotId === spotId && t.visitDate === visitDate);
        if (hasTask) { status = 'WAITING'; button = { text: '待提醒', enabled: false }; }
        else if (inCart) { status = 'IN_CART'; button = { text: '已加清单', enabled: true, openCart: true }; }
        else { status = 'SELECTABLE'; button = { text: '添加提醒', enabled: true }; }
      } else {
        status = 'BOOKABLE'; button = { text: '立即预约', enabled: true, booking: true }; stale = true;
      }
      events.push({
        spotId, spotName: spot.name, visitDate, releaseAt: releaseAt.toISOString(),
        releaseDateStr: releaseDate, releaseTimeStr: spot.releaseTime,
        visitDateLabel: formatMonthDayWeek(visitDate), advanceDays: spot.advanceDays,
        difficulty: difficultyLabel(spot.difficultyScore),
        officialAppid: spot.officialAppid || '', officialPath: spot.officialPath || '', officialWebUrl: spot.officialWebUrl || '',
        status, button, stale,
      });
      hasEvent = true;
    }
    if (!hasEvent) closedSpots.push({ spotId, spotName: spot.name, note: '行程期间闭馆' });
  }

  const depMap = {};
  events.forEach(e => { (depMap[e.visitDate] = depMap[e.visitDate] || []).push(e); });
  const byDeparture = Object.keys(depMap).sort().map(k => ({
    key: k, label: formatMonthDayWeek(k),
    events: depMap[k].sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    count: depMap[k].length, scrollIndex: 0,
  }));
  const spotMap = {};
  events.forEach(e => { (spotMap[e.spotId] = spotMap[e.spotId] || []).push(e); });
  const bySpot = Object.keys(spotMap).map(k => ({
    key: k, label: spotMap[k][0].spotName,
    events: spotMap[k].sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    count: spotMap[k].length, scrollIndex: 0,
  })).sort((a, b) => new Date(a.events[0].releaseAt) - new Date(b.events[0].releaseAt));

  return {
    success: true, tripId,
    trip: { _id: trip._id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, spotIds: trip.spotIds },
    events, byDeparture, bySpot, closedSpots,
    empty: events.length === 0,
    emptyReason: events.length === 0 ? (closedSpots.length > 0 ? '该行程暂无可提醒的放票时间' : '先选择想去的景点') : null,
  };
}

/* 行程变化后，清理落在新行程范围/景点之外的清单项（TIMELINE-RULE-002） */
function pruneStaleCart(tripId) {
  const tl = generateTimeline(tripId);
  if (!tl || !tl.success) return;
  const keys = new Set(tl.events.map(e => e.spotId + '|' + e.visitDate));
  Object.keys(db.carts).forEach(id => {
    const c = db.carts[id];
    if (c.tripId === tripId && !keys.has(c.spotId + '|' + c.visitDate)) delete db.carts[id];
  });
}

/* ===== handlers：key = data.action ===== */
const handlers = {
  /* ----- spots ----- */
  'list': () => ({ success: true, data: SPOTS.map(buildCard).sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0)) }),
  'detail': (data) => {
    const spot = SPOTS.find(s => s.spotId === data.spotId);
    if (!spot) return { success: false, error: '景点不存在', errorCode: 1001 };
    const entries = [];
    // 预约方式排序：有微信小程序则小程序排第一（SORT-RULE-001 按直达率），其后 公众号 → 官网；缺失渠道不显示
    if (spot.officialAppid) entries.push({ type: 'MINIPROGRAM', label: '官方小程序', appid: spot.officialAppid, path: spot.officialPath || '', url: spot.officialWebUrl || '', hint: '绑定证件信息 → 参与预约' });
    if (spot.officialAccount) entries.push({ type: 'OFFICIAL_ACCOUNT', label: '微信公众号', value: spot.officialAccount, qrCode: spot.qrCode || '', hint: '点击参与预约 → 填写信息 → 预约成功' });
    if (spot.officialWebUrl) entries.push({ type: 'WEB', label: '景区官网', url: spot.officialWebUrl, hint: '点击预约入口 → 扫小程序码' });
    const rule = RULES.find(r => r.spotId === data.spotId) || {};
    return { success: true, data: { ...buildCard(spot), address: spot.address || spot.district, location: null, entries, bookingTips: rule.bookingTips || '', openTime: rule.openTime || '', ticketPrice: rule.ticketPrice || '', idRequirement: rule.idRequirement || '', ageLimit: rule.ageLimit || '', closedDaysLabel: closedDaysLabel(spot.closedDays) } };
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
    const city = data.city || '北京';
    const incoming = { city, startDate: data.startDate, endDate: data.endDate, spotIds: data.spotIds || [] };
    const merges = Object.values(db.trips)
      .filter(t => t.status === 'ACTIVE' && t.city === city && canMergeTrips(incoming, t));
    if (merges.length === 0) {
      const tripId = 'mock-trip-' + (++tripSeq);
      db.trips[tripId] = { _id: tripId, city, startDate: incoming.startDate, endDate: incoming.endDate, spotIds: incoming.spotIds, name: buildMockTripName(city, incoming.startDate, incoming.endDate), status: 'ACTIVE' };
      return { success: true, tripId, merged: false, mergedFrom: [], trip: db.trips[tripId] };
    }
    /* 合并：日期取并集，保留第一个，其余删除并把任务/清单改挂到存续行程 */
    const keep = merges[0];
    const drops = merges.slice(1);
    const range = [incoming, keep, ...drops].reduce((r, x) => ({
      startDate: r.startDate < x.startDate ? r.startDate : x.startDate,
      endDate: r.endDate > x.endDate ? r.endDate : x.endDate,
    }), { startDate: incoming.startDate, endDate: incoming.endDate });
    keep.startDate = range.startDate;
    keep.endDate = range.endDate;
    keep.name = buildMockTripName(city, range.startDate, range.endDate);
    const spots = new Set(incoming.spotIds);
    [keep, ...drops].forEach(t => (t.spotIds || []).forEach(id => spots.add(id)));
    keep.spotIds = [...spots];
    drops.forEach(d => {
      Object.values(db.tasks).forEach(t => { if (t.tripId === d._id) t.tripId = keep._id; });
      Object.values(db.carts).forEach(c => { if (c.tripId === d._id) c.tripId = keep._id; });
      delete db.trips[d._id];
    });
    return { success: true, tripId: keep._id, merged: true, mergedFrom: [keep._id, ...drops.map(d => d._id)], trip: keep };
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
    return { success: true, trips: kept, showGroupTabs: kept.length >= 2 };
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
  'user.profile': () => ({ success: true, user: { openId: 'mock-user', nickname: '游客', avatarUrl: '', memberLevel: 'NORMAL', points: 0, subscribeQuota: subscribeSeq, notifyPrefs: { officialAccount: false, sms: false, offsets: [5, 2] } } }),
  'user.updateNotifyPrefs': (data) => ({ success: true, notifyPrefs: data.notifyPrefs }),

  /* ----- 订阅消息额度（一次性订阅） ----- */
  'subscribe.add': () => { subscribeSeq += 1; return { success: true, quota: subscribeSeq }; },
  'subscribe.get': () => ({ success: true, quota: subscribeSeq }),

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

};

function mockCall(name, data) {
  const action = (data && data.action) || name;
  const h = handlers[action];
  if (!h) return Promise.reject({ success: false, error: 'mock 未实现: ' + name + '.' + action, errorCode: 1099 });
  try {
    return Promise.resolve(h(data || {}));
  } catch (e) {
    return Promise.reject({ success: false, error: e.message, errorCode: 1500 });
  }
}

/* 供页面 fallback 使用：单一数据源，避免各页本地 MOCK 漂移 */
function spotsListCards() { return SPOTS.map(buildCard); }

module.exports = { mockCall, USE_MOCK, SPOTS, spotsListCards };
