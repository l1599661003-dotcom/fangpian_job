const jobs = [
  {
    title: "达人孵化负责人",
    bu: "内容增长事业部",
    city: "上海",
    type: "社招",
    salary: "40-55K",
    label: "热度最高",
    summary:
      "负责达人从 0 到 1 孵化、内容策略拆解、团队方法论沉淀，适合有达人运营与商业变现经验的人选。",
    tags: ["达人孵化", "MCN", "商业化", "负责人"],
  },
  {
    title: "AI 内容运营经理",
    bu: "AI增长事业部",
    city: "北京",
    type: "社招",
    salary: "28-40K",
    label: "增长中岗位",
    summary:
      "把 AI 工具接入内容生产流程，优化脚本、投放、复盘和组织协同效率。",
    tags: ["AI内容", "流程建设", "内容运营"],
  },
  {
    title: "品牌商务经理",
    bu: "商业化事业部",
    city: "杭州",
    type: "社招",
    salary: "25-35K",
    label: "商务变现",
    summary:
      "负责品牌合作与商业方案推进，关注客户经营、投放复盘和跨团队交付闭环。",
    tags: ["品牌合作", "商务变现", "客户经营"],
  },
  {
    title: "校招产品培训生",
    bu: "平台产品中心",
    city: "上海",
    type: "校招",
    salary: "12-16K",
    label: "2027 校招",
    summary:
      "参与招聘中台、内容工具、经营分析等产品建设，适合有结构化分析能力的应届生。",
    tags: ["校招", "产品", "训练营"],
  },
  {
    title: "达人自孵运营",
    bu: "内容增长事业部",
    city: "广州",
    type: "社招",
    salary: "18-28K",
    label: "赛道专题",
    summary:
      "负责达人账号日常运营、内容复盘与增长实验，强调数据敏感度和执行闭环能力。",
    tags: ["自孵", "内容运营", "短视频"],
  },
  {
    title: "校招商业分析管培生",
    bu: "商业化事业部",
    city: "北京",
    type: "校招",
    salary: "13-18K",
    label: "秋招开放",
    summary:
      "围绕商业项目经营、渠道投放和数据复盘进行轮岗培养，适合有经营分析意识的应届生。",
    tags: ["校招", "商业分析", "轮岗"],
  },
];

const progressMock = {
  position: "AI 内容运营经理",
  status: "进入二面",
  meta: "候选人：王同学 · 最新更新：2026-07-01 10:30",
  steps: [
    ["已投递", "简历已进入系统并完成解析，已回流招聘中台主档。"],
    ["AI 初筛通过", "岗位标签匹配度 89 分，已推送对应 HRBP。"],
    ["一面已完成", "HRBP 面已完成，进入业务负责人面试排期。"],
    ["进入二面", "请留意短信与站内信中的面试时间确认。"],
    ["Offer / 入职", "通过后将在此页面继续显示 Offer 与入职进度。"],
  ],
};

const grid = document.getElementById("job-grid");
const template = document.getElementById("job-card-template");
const searchInput = document.getElementById("job-search");
const filterBu = document.getElementById("filter-bu");
const filterCity = document.getElementById("filter-city");
const filterType = document.getElementById("filter-type");
const chipRow = document.getElementById("job-chips");
const progressForm = document.getElementById("progress-form");
const progressResult = document.getElementById("progress-result");

let activeTag = "全部";

function uniqueValues(key) {
  return [...new Set(jobs.map((job) => job[key]))];
}

function fillSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function buildChips() {
  const tags = ["全部", ...new Set(jobs.flatMap((job) => job.tags))].slice(0, 8);
  tags.forEach((tag) => {
    const button = document.createElement("button");
    button.className = `job-chip${tag === activeTag ? " active" : ""}`;
    button.type = "button";
    button.textContent = tag;
    button.addEventListener("click", () => {
      activeTag = tag;
      [...chipRow.children].forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      renderJobs();
    });
    chipRow.appendChild(button);
  });
}

function renderJobs() {
  const keyword = searchInput.value.trim().toLowerCase();
  const bu = filterBu.value;
  const city = filterCity.value;
  const type = filterType.value;

  const filtered = jobs.filter((job) => {
    const inKeyword =
      !keyword ||
      [job.title, job.bu, job.summary, ...job.tags].join(" ").toLowerCase().includes(keyword);
    const inBu = bu === "all" || job.bu === bu;
    const inCity = city === "all" || job.city === city;
    const inType = type === "all" || job.type === type;
    const inTag = activeTag === "全部" || job.tags.includes(activeTag);
    return inKeyword && inBu && inCity && inType && inTag;
  });

  grid.innerHTML = "";
  filtered.forEach((job) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".job-label").textContent = job.label;
    card.querySelector(".job-title").textContent = job.title;
    card.querySelector(".job-salary").textContent = job.salary;
    card.querySelector(".job-meta").textContent = `${job.bu} · ${job.city} · ${job.type}`;
    card.querySelector(".job-summary").textContent = job.summary;
    const tags = card.querySelector(".job-tags");
    job.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag;
      tags.appendChild(chip);
    });
    grid.appendChild(card);
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <article class="job-card">
        <strong>没有找到符合条件的岗位</strong>
        <p class="job-summary">可以调整筛选条件，或在 ARP 落地时接入真实岗位数据源。</p>
      </article>
    `;
  }
}

function renderProgressResult() {
  progressResult.innerHTML = `
    <div class="progress-result-header">
      <div>
        <strong>${progressMock.position}</strong>
        <p>${progressMock.meta}</p>
      </div>
      <span class="status-pill">${progressMock.status}</span>
    </div>
    <div class="progress-timeline">
      ${progressMock.steps
        .map(
          ([title, text], index) => `
            <div class="progress-step${index === 3 ? " active" : ""}">
              <div class="progress-step-dot"></div>
              <div class="progress-step-content">
                <strong>${title}</strong>
                <p>${text}</p>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

fillSelect(filterBu, uniqueValues("bu"));
fillSelect(filterCity, uniqueValues("city"));
buildChips();
renderJobs();

[searchInput, filterBu, filterCity, filterType].forEach((node) =>
  node.addEventListener("input", renderJobs)
);

progressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  renderProgressResult();
});
