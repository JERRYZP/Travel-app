const attractions = [
  {
    id: "palace",
    name: "故宫博物院",
    category: "博物馆",
    difficulty: "hard",
    priceType: "paid",
    tags: ["世界遗产", "极难约"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/Beijing%20China%20Forbidden-City-02.jpg?width=900",
    status: "7日前 20:00 开放",
    nextRelease: "今晚 20:00",
    earliest: "6月3日",
    countdown: "08:12:44",
    rule: "参观前 7 日 20:00 开始预约，不售当日票，实名制预约检票。",
    document: "身份证原件；年票观众至少提前一日登记。",
    limit: "未使用门票可按官方规则退票；180 日内累计爽约 3 次会限制预约。",
    sourceLabel: "故宫博物院在线订票",
    sourceUrl: "https://www.dpm.org.cn/subject_booking/",
    calendar: ["soon", "closed", "closed", "available", "available", "closed", "available"],
    followed: true,
  },
  {
    id: "chnmuseum",
    name: "中国国家博物馆",
    category: "博物馆",
    difficulty: "hard",
    priceType: "free",
    tags: ["免费预约", "今日放票"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/20200110%20National%20Museum%20of%20China-2.jpg?width=900",
    status: "每日 17:00 放票",
    nextRelease: "今日 17:00",
    earliest: "6月2日",
    countdown: "05:12:44",
    rule: "可提前 7 日内在官网、官方小程序、微信小程序和公众号预约，预约放票时间为每日 17:00。",
    document: "有效身份证件实名认证；按预约时段从北门核验入馆。",
    limit: "每个账号每周最多预约 1 次，每次最多 5 人；同一证件号每月最多预约 4 次。",
    sourceLabel: "中国国家博物馆预约服务系统",
    sourceUrl: "https://pcticket.chnmuseum.cn/museum-en/",
    calendar: ["closed", "soon", "available", "available", "closed", "available", "available"],
    followed: true,
  },
  {
    id: "tiananmen",
    name: "天安门城楼",
    category: "古迹",
    difficulty: "hard",
    priceType: "paid",
    tags: ["实名预约", "提前一天"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/Tiananmen%20Gate%202019.jpg?width=900",
    status: "至少提前 1 天",
    nextRelease: "以官方渠道为准",
    earliest: "5月29日",
    countdown: "待确认",
    rule: "须至少提前一日通过官方网站或“天安门城楼参观预约”微信公众号实名预约购票。",
    document: "凭有效证件预约和核验；未满 14 周岁儿童需成年人陪同。",
    limit: "18 周岁以下、60 周岁以上中国公民等符合条件人群预约后可免费参观。",
    sourceLabel: "北京市人民政府门户网站",
    sourceUrl: "https://www.beijing.gov.cn/renwen/cshd/202306/t20230612_3129937.html",
    calendar: ["available", "available", "closed", "available", "closed", "available", "available"],
    followed: false,
  },
  {
    id: "tiantan",
    name: "天坛公园",
    category: "公园",
    difficulty: "easy",
    priceType: "paid",
    tags: ["现阶段免预约", "世界遗产"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/20200110%20Temple%20of%20Heaven-8.jpg?width=900",
    status: "官网显示免预约",
    nextRelease: "无需抢票",
    earliest: "今日可去",
    countdown: "开放中",
    rule: "官网当前提示门票现阶段实行免预约、现场瞬时客流管控参观模式。",
    document: "园中景点开放时间分旺淡季，入园与园中园规则以现场和官方公告为准。",
    limit: "遇瞬时客流高峰可能限流。",
    sourceLabel: "北京天坛官方网站",
    sourceUrl: "https://www.tiantanpark.com/",
    calendar: ["available", "available", "available", "available", "available", "available", "available"],
    followed: false,
  },
  {
    id: "badaling",
    name: "八达岭长城",
    category: "古迹",
    difficulty: "medium",
    priceType: "paid",
    tags: ["实名预约", "长城"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/Great%20Wall,%20Badaling%20(9862980903).jpg?width=900",
    status: "可提前 7 天",
    nextRelease: "明日 00:00",
    earliest: "6月3日",
    countdown: "15:12:44",
    rule: "官方文旅信息显示八达岭长城实行全网实名预约售票，可提前 7 天进行网上预约购票。",
    document: "购票和入园证件需一致，具体渠道以景区官方售票系统为准。",
    limit: "旺季客流较大，建议避开周末上午高峰。",
    sourceLabel: "北京旅游网",
    sourceUrl: "https://www.visitbeijing.com.cn/article/47QmKoFtnnF",
    calendar: ["closed", "available", "available", "soon", "available", "closed", "available"],
    followed: true,
  },
  {
    id: "nnhm",
    name: "国家自然博物馆",
    category: "博物馆",
    difficulty: "medium",
    priceType: "free",
    tags: ["免费预约", "亲子"],
    image: "https://commons.wikimedia.org/wiki/Special:FilePath/Beijing%20Museum%20of%20Natural%20History%20exterior%202010%20Sep%2004.jpg?width=900",
    status: "提前 3 天 11:00",
    nextRelease: "明日 11:00",
    earliest: "5月30日",
    countdown: "26:12:44",
    rule: "个人观众请提前 3 日在国家自然博物馆官方网站或微信公众号预约，每日 11:00 更新。",
    document: "三个参观时段分别为 9:00-11:00、11:00-14:00、14:00-16:00。",
    limit: "如无法按时入馆，可于参观当日 16:30 前申请退票。",
    sourceLabel: "国家自然博物馆门票预约",
    sourceUrl: "https://www.nnhm.org.cn/cgzx/mpyy/index.shtml",
    calendar: ["soon", "available", "available", "closed", "available", "available", "closed"],
    followed: true,
  },
];

const timeline = [
  { time: "10:55", title: "国家自然博物馆", sub: "提前 5 分钟准备预约", state: "warning" },
  { time: "16:55", title: "中国国家博物馆", sub: "今日 17:00 放票", state: "warning" },
  { time: "20:00", title: "故宫博物院", sub: "6 月 3 日门票开放预约", state: "pending" },
];

let currentFilter = "all";
let pickedDate = "6/3";

const listEl = document.querySelector("#attractionList");
const followListEl = document.querySelector("#followList");
const timelineEl = document.querySelector("#timeline");
const detailView = document.querySelector("#detailView");
const detailContent = document.querySelector("#detailContent");
const toast = document.querySelector("#toast");

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("is-show");
  window.setTimeout(() => toast.classList.remove("is-show"), 1800);
}

function filteredAttractions() {
  if (currentFilter === "all") return attractions;
  if (currentFilter === "hard") return attractions.filter((item) => item.difficulty === "hard");
  if (currentFilter === "soon") return attractions.filter((item) => item.tags.includes("今日放票"));
  if (currentFilter === "free") return attractions.filter((item) => item.priceType === "free");
  return attractions;
}

function calendarHtml(days) {
  return days
    .map((state, index) => {
      const day = 28 + index > 31 ? index - 3 : 28 + index;
      return `<span class="day ${state}">${day}</span>`;
    })
    .join("");
}

function cardHtml(item) {
  const followText = item.followed ? "★" : "☆";
  const greenTag = item.priceType === "free" ? " green" : "";
  return `
    <article class="attraction-card" data-id="${item.id}">
      <div class="card-image" style="background-image: linear-gradient(180deg, rgba(30,17,10,0.02), rgba(30,17,10,0.52)), url('${item.image}')">
        <span class="status-pill">${item.status}</span>
        <span class="status-pill">${item.countdown}</span>
      </div>
      <div class="card-body">
        <div class="card-top">
          <div>
            <h3 class="card-title">${item.name}</h3>
            <div class="tags">
              <span class="tag">${item.category}</span>
              ${item.tags.map((tag) => `<span class="tag${tag.includes("免费") ? greenTag : ""}">${tag}</span>`).join("")}
            </div>
          </div>
          <button class="follow-btn ${item.followed ? "is-on" : ""}" type="button" data-follow="${item.id}" aria-label="关注 ${item.name}">${followText}</button>
        </div>
        <div class="meta-grid">
          <div class="meta-box">
            <span>最早可约</span>
            <strong>${item.earliest}</strong>
          </div>
          <div class="meta-box">
            <span>下次提醒</span>
            <strong>${item.nextRelease}</strong>
          </div>
        </div>
        <div class="mini-calendar">${calendarHtml(item.calendar)}</div>
        <div class="card-actions">
          <button class="secondary-button" type="button" data-detail="${item.id}">查看规则</button>
          <button class="primary-button" type="button" data-remind="${item.id}">设置提醒</button>
        </div>
      </div>
    </article>
  `;
}

function renderList() {
  listEl.innerHTML = filteredAttractions().map(cardHtml).join("");
  renderFollows();
  updateCounts();
}

function renderFollows() {
  const followed = attractions.filter((item) => item.followed);
  followListEl.innerHTML = followed
    .map(
      (item) => `
        <div class="follow-row">
          <div>
            <h3>${item.name}</h3>
            <p>${item.nextRelease} · ${item.earliest}</p>
          </div>
          <button class="small-action" type="button" data-detail="${item.id}">规则</button>
        </div>
      `,
    )
    .join("");
}

function renderTimeline() {
  timelineEl.innerHTML = timeline
    .map(
      (item) => `
        <div class="timeline-item">
          <span class="timeline-time">${item.time}</span>
          <div>
            <p class="timeline-title">${item.title}</p>
            <p class="timeline-sub">${item.sub}</p>
          </div>
          <span class="state-dot ${item.state}"></span>
        </div>
      `,
    )
    .join("");
}

function updateCounts() {
  const followedCount = attractions.filter((item) => item.followed).length;
  document.querySelector("#followCount").textContent = followedCount;
  document.querySelector("#mineFollowCount").textContent = `${followedCount} 个`;
  document.querySelector("#todayCount").textContent = attractions.filter((item) => item.tags.includes("今日放票")).length + 2;
}

function openDetail(id) {
  const item = attractions.find((entry) => entry.id === id);
  if (!item) return;

  detailContent.innerHTML = `
    <div class="detail-hero" style="background-image: linear-gradient(180deg, rgba(30,17,10,0.02), rgba(30,17,10,0.58)), url('${item.image}')">
      <div>
        <span class="status-pill">${item.category}</span>
        <h2>${item.name}</h2>
      </div>
    </div>
    <div class="detail-content">
      <section class="rule-grid">
        <article class="rule-card">
          <span>预约周期</span>
          <h3>${item.status}</h3>
          <p>${item.rule}</p>
        </article>
        <article class="rule-card">
          <span>证件要求</span>
          <h3>实名核验</h3>
          <p>${item.document}</p>
        </article>
        <article class="rule-card">
          <span>限制提醒</span>
          <h3>别错过规则细节</h3>
          <p>${item.limit}</p>
        </article>
      </section>
      <section class="reminder-box">
        <div class="panel-title">
          <span>设置提醒</span>
          <strong>${item.nextRelease}</strong>
        </div>
        <div class="date-picker">
          ${["5/29", "5/30", "5/31", "6/2", "6/3"].map((date) => `<button class="date-option ${date === pickedDate ? "is-picked" : ""}" type="button" data-date="${date}">${date}</button>`).join("")}
        </div>
        <button class="primary-button" type="button" data-save-reminder="${item.id}">提前 5 分钟提醒我</button>
      </section>
      <section class="source-box">
        <p>规则来源：<a href="${item.sourceUrl}" target="_blank" rel="noreferrer">${item.sourceLabel}</a></p>
      </section>
    </div>
  `;
  detailView.classList.add("is-open");
  detailView.setAttribute("aria-hidden", "false");
}

function closeDetail() {
  detailView.classList.remove("is-open");
  detailView.setAttribute("aria-hidden", "true");
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    document.querySelectorAll(".tab-item").forEach((item) => item.classList.remove("is-active"));
    tabButton.classList.add("is-active");
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("view-active"));
    document.querySelector(`#view-${tabButton.dataset.tab}`).classList.add("view-active");
  }

  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    currentFilter = filterButton.dataset.filter;
    document.querySelectorAll(".chip").forEach((item) => item.classList.remove("is-active"));
    filterButton.classList.add("is-active");
    renderList();
  }

  const followButton = event.target.closest("[data-follow]");
  if (followButton) {
    const item = attractions.find((entry) => entry.id === followButton.dataset.follow);
    item.followed = !item.followed;
    renderList();
    showToast(item.followed ? "已加入关注" : "已取消关注");
  }

  const detailButton = event.target.closest("[data-detail]");
  if (detailButton) openDetail(detailButton.dataset.detail);

  const remindButton = event.target.closest("[data-remind]");
  if (remindButton) {
    openDetail(remindButton.dataset.remind);
    window.setTimeout(() => showToast("已打开提醒设置"), 120);
  }

  const dateButton = event.target.closest("[data-date]");
  if (dateButton) {
    pickedDate = dateButton.dataset.date;
    document.querySelectorAll(".date-option").forEach((item) => item.classList.remove("is-picked"));
    dateButton.classList.add("is-picked");
  }

  const saveButton = event.target.closest("[data-save-reminder]");
  if (saveButton) showToast(`已为 ${pickedDate} 生成提醒`);
});

document.querySelector("#closeDetail").addEventListener("click", closeDetail);
document.querySelector("#refreshBtn").addEventListener("click", () => {
  document.querySelector("#lastUpdated").textContent = "刚刚同步";
  showToast("预约状态已刷新");
});

document.querySelector("#copyIdBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("110101199001011234");
    showToast("证件号已复制");
  } catch {
    showToast("当前浏览器不支持复制");
  }
});

renderList();
renderTimeline();
