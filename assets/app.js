(() => {
  "use strict";

  const app = document.querySelector("#app");
  const backHome = document.querySelector("#back-home");
  const headerSubtitle = document.querySelector("#header-subtitle");
  const statusStrip = document.querySelector("#status-strip");
  const saveStatus = document.querySelector("#save-status");
  const resultStatus = document.querySelector("#result-status");
  const statusContext = document.querySelector("#status-context");
  const menuButton = document.querySelector("#menu-button");
  const headerMenu = document.querySelector("#header-menu");
  const helpButton = document.querySelector("#help-button");
  const mobileActionBar = document.querySelector("#mobile-action-bar");
  const fileInput = document.querySelector("#file-input");
  const dialog = document.querySelector("#app-dialog");
  const dialogEyebrow = document.querySelector("#dialog-eyebrow");
  const dialogTitle = document.querySelector("#dialog-title");
  const dialogContent = document.querySelector("#dialog-content");
  const dialogConfirm = document.querySelector("#dialog-confirm");
  const toastRegion = document.querySelector("#toast-region");

  const UNIT_TO_ML = { nL: 0.000001, "µL": 0.001, mL: 1, cL: 10, dL: 100, L: 1000 };
  const UNITS = Object.keys(UNIT_TO_ML);
  const PHASE_CODES = ["A", "B", "C", "D"];
  const APP_VERSION = "1.2.0";
  const CHART_COLORS = ["#2563eb", "#079455", "#b54708", "#d92d20"];
  const WINDOW_COLORS = ["#7c3aed", "#c026d3", "#db2777", "#c2410c", "#0e7490", "#4338ca", "#047857", "#a16207"];
  const STORAGE = {
    solution: "lab-calculator.solution.draft.v2",
    hplc: "lab-calculator.hplc.draft.v2",
    concentration: "lab-calculator.concentration.draft.v1",
    recent: "lab-calculator.recent-tool",
    mediaPrefs: "lab-calculator.media.preferences.v1",
  };

  let activeFileHandler = null;
  let mediaCatalog = null;
  let mediaLoadError = "";
  let autosaveTimer = null;
  let chartObserver = null;

  const ui = {
    solutionTab: "structure",
    mediaTab: "amounts",
    hiddenPhases: new Set(),
  };

  const e = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const uid = () =>
    globalThis.crypto?.randomUUID?.().replaceAll("-", "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  const numberText = (value, digits = 6) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number === 0) return "0";
    if (Math.abs(number) >= 1_000_000 || Math.abs(number) < 0.0001) return number.toPrecision(6);
    return number.toFixed(digits).replace(/\.?0+$/, "");
  };

  const formatTime = (date = new Date()) =>
    new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);

  const download = (filename, content, type = "application/json;charset=utf-8") => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const safeParse = (value, fallback) => {
    if (value == null || value === "") return fallback;
    try {
      return JSON.parse(value) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const toast = (message, options = {}) => {
    const node = document.createElement("div");
    node.className = `toast ${options.kind === "warning" ? "warning-toast" : ""} ${options.kind === "error" ? "error-toast" : ""}`;
    const text = document.createElement("span");
    text.textContent = message;
    node.append(text);
    if (options.actionLabel && options.onAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = options.actionLabel;
      button.addEventListener("click", () => {
        options.onAction();
        node.remove();
      });
      node.append(button);
    }
    toastRegion.append(node);
    setTimeout(() => node.remove(), options.duration || 6000);
  };

  const confirmAction = ({ eyebrow = "请确认", title, body, confirmText = "确认", danger = false }) =>
    new Promise((resolve) => {
      dialogEyebrow.textContent = eyebrow;
      dialogTitle.textContent = title;
      dialogContent.innerHTML = body;
      dialogConfirm.textContent = confirmText;
      dialogConfirm.className = `button ${danger ? "danger-button" : "primary"}`;
      const close = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "confirm");
      };
      const onClose = () => close();
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });

  const showInformation = ({ eyebrow = "帮助与边界", title, body }) => {
    dialogEyebrow.textContent = eyebrow;
    dialogTitle.textContent = title;
    dialogContent.innerHTML = body;
    dialogConfirm.textContent = "知道了";
    dialogConfirm.className = "button primary";
    dialog.showModal();
  };

  const openFile = (handler) => {
    activeFileHandler = handler;
    fileInput.value = "";
    fileInput.click();
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || !activeFileHandler) return;
    try {
      const text = await file.text();
      await activeFileHandler(text, file.name);
    } catch (error) {
      toast(`导入失败：${error.message}`, { kind: "error" });
    } finally {
      activeFileHandler = null;
    }
  });

  const setBadge = (element, text, kind = "neutral") => {
    element.className = `status-badge ${kind}`;
    element.textContent = text;
  };

  const setShell = ({ title, showStatus = true, save = "数据保存在当前浏览器", saveKind = "neutral", result = "尚无计算结果", resultKind = "neutral", context = "", menu = [] }) => {
    backHome.hidden = title === "首页";
    headerSubtitle.textContent = title === "首页" ? "让实验计算更清楚、更可复核" : title;
    statusStrip.hidden = !showStatus;
    setBadge(saveStatus, save, saveKind);
    setBadge(resultStatus, result, resultKind);
    statusContext.textContent = context;
    headerMenu.innerHTML = menu.map((item, index) => `<button type="button" data-menu-index="${index}">${e(item.label)}</button>`).join("");
    headerMenu.onclick = (event) => {
      const button = event.target.closest("[data-menu-index]");
      if (!button) return;
      menu[Number(button.dataset.menuIndex)]?.action();
      closeMenu();
    };
  };

  const closeMenu = () => {
    headerMenu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  };

  menuButton.addEventListener("click", () => {
    const willOpen = headerMenu.hidden;
    headerMenu.hidden = !willOpen;
    menuButton.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".header-actions")) closeMenu();
  });

  backHome.addEventListener("click", () => {
    location.hash = "#/";
  });

  helpButton.addEventListener("click", () => {
    showInformation({
      title: "数据、计算与专业边界",
      body: `
        <div class="alert info"><strong>数据默认不上传。</strong><p>草稿保存在当前浏览器。清除浏览器数据、使用无痕模式、换设备或换浏览器都可能导致草稿丢失，请下载方案文件留存。</p></div>
        <h3>溶液配制</h3><p>仅按体积比例计算，不引入密度、纯度、物质的量或体积收缩模型。</p>
        <h3>溶出介质</h3><p>生成结果必须结合现行药典、品种各论、注册标准与实验室 SOP 复核；机器解析条目会持续显示警告。</p>
        <h3>HPLC</h3><p>洗脱窗口和梯度调整属于初步实验建议，不是“最佳方法”或保留时间预测。应用前需通过混合标准品和实际系统验证。</p>
        <h3>浓度与稀释</h3><p>仅提供理论计算和操作辅助。分子量、纯度和密度均以用户录入值为准，结果必须结合试剂标签、SDS、实验室 SOP 与适用温度复核。</p>
      `,
    });
  });

  const setMobileAction = (html = "", handler = null) => {
    mobileActionBar.innerHTML = html;
    mobileActionBar.hidden = !html;
    document.body.classList.toggle("has-mobile-bar", Boolean(html));
    mobileActionBar.onclick = handler;
  };

  const scheduleSave = (type, data, callback) => {
    clearTimeout(autosaveTimer);
    setBadge(saveStatus, "正在保存草稿", "info");
    autosaveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE[type], JSON.stringify(data));
      setBadge(saveStatus, `草稿已保存 · ${formatTime()}`, "success");
      callback?.();
    }, 800);
  };

  const focusMain = () => {
    document.querySelector("#main-content").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const homeTools = [
    {
      route: "solution",
      number: "01",
      category: "VOLUME RECIPE",
      title: "溶液配制辅助",
      description: "拆解任意层级比例，计算所有最终组分的实际用量。",
      outputs: ["比例树", "叶子组分", "单位换算"],
    },
    {
      route: "dissolution",
      number: "02",
      category: "DISSOLUTION MEDIA",
      title: "溶出介质配制辅助",
      description: "按药典与介质筛选处方，并按目标体积生成用量与 SOP。",
      outputs: ["试剂用量", "SOP", "来源"],
    },
    {
      route: "hplc",
      number: "03",
      category: "HPLC GRADIENT",
      title: "HPLC梯度程序辅助",
      description: "录入梯度和目标物，估算流动相比例与潜在洗脱窗口。",
      outputs: ["梯度图", "比例", "优化建议"],
    },
    {
      route: "concentration",
      number: "04",
      category: "CONCENTRATION & DILUTION",
      title: "浓度与稀释配制辅助",
      description: "计算固体称量、液体试剂取用和母液稀释，生成可复核的配制步骤。",
      outputs: ["称量", "移取", "稀释"],
    },
  ];

  function renderHome() {
    localStorage.setItem(STORAGE.recent, "home");
    setShell({ title: "首页", showStatus: false, menu: [] });
    setMobileAction();
    app.innerHTML = `
      <div class="page">
        <section class="hero" aria-labelledby="home-title">
          <p class="eyebrow" style="color:#9fc5ff">LABORATORY WORKSPACE · V${APP_VERSION}</p>
          <h1 id="home-title">把复杂实验计算，整理成可复核的步骤</h1>
          <p>选择任务，按输入顺序完成计算。每项结果都保留状态、依据与专业边界，适合桌面浏览器和实验现场手机查看。</p>
          <div class="hero-meta">
            <span>✓ 核心计算可离线运行</span>
            <span>✓ 草稿保存在当前浏览器</span>
            <span>✓ 结果需按实验室 SOP 复核</span>
          </div>
        </section>
        <div class="section-heading">
          <div>
            <h2>选择一个实验任务</h2>
            <p>四个工具独立工作，状态和文件操作保持一致。</p>
          </div>
        </div>
        <section class="tool-grid" aria-label="实验室计算工具">
          ${homeTools
            .map(
              (tool) => `
                <article class="tool-card" tabindex="0" role="link" data-route="${tool.route}" aria-label="打开${tool.title}">
                  <span class="tool-number">${tool.number}</span>
                  <span class="tool-category">${tool.category}</span>
                  <h2>${tool.title}</h2>
                  <p>${tool.description}</p>
                  <div class="tool-output">${tool.outputs.map((item) => `<span class="tag neutral">${item}</span>`).join("")}</div>
                  <span class="tool-arrow" aria-hidden="true">→</span>
                </article>
              `,
            )
            .join("")}
        </section>
        <div class="trust-note">
          <span aria-hidden="true">◉</span>
          <div><strong>数据保存在当前浏览器。</strong> 初期版本不上传实验数据；清除浏览器数据或更换设备前，请在工具页下载方案文件。</div>
        </div>
      </div>
    `;
    app.querySelectorAll(".tool-card").forEach((card) => {
      const open = () => {
        location.hash = `#/${card.dataset.route}`;
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  const exampleRecipe = () => ({
    format: "lab-calculator-recipe",
    version: 1,
    name: "乙腈-0.1%甲酸水（1:9）",
    total_volume: 500,
    total_unit: "mL",
    root: {
      id: uid(),
      name: "最终溶液",
      ratio: 1,
      children: [
        { id: uid(), name: "乙腈", ratio: 1, children: [] },
        {
          id: uid(),
          name: "0.1%甲酸水相",
          ratio: 9,
          children: [
            { id: uid(), name: "甲酸", ratio: 0.1, children: [] },
            { id: uid(), name: "水", ratio: 99.9, children: [] },
          ],
        },
      ],
    },
    calculated: null,
    selectedId: null,
    outputUnits: {},
  });

  const blankRecipe = () => ({
    format: "lab-calculator-recipe",
    version: 1,
    name: "新配方",
    total_volume: 100,
    total_unit: "mL",
    root: {
      id: uid(),
      name: "最终溶液",
      ratio: 1,
      children: [
        { id: uid(), name: "组分 A", ratio: 1, children: [] },
        { id: uid(), name: "组分 B", ratio: 1, children: [] },
      ],
    },
    calculated: null,
    selectedId: null,
    outputUnits: {},
  });

  let solution = safeParse(localStorage.getItem(STORAGE.solution), exampleRecipe());
  solution.calculated = null;
  solution.outputUnits ||= {};
  solution.selectedId ||= solution.root.children[0]?.id || null;

  const walkNodes = (node, depth = 0, parent = null, output = []) => {
    output.push({ node, depth, parent });
    node.children.forEach((child) => walkNodes(child, depth + 1, node, output));
    return output;
  };

  const findNode = (root, id) => walkNodes(root).find((item) => item.node.id === id);

  const calculateRecipe = () => {
    const total = Number(solution.total_volume);
    if (!Number.isFinite(total) || total <= 0) throw new Error("最终总体积必须大于 0");
    if (!UNIT_TO_ML[solution.total_unit]) throw new Error("请选择有效的体积单位");
    if (!solution.root.children.length) throw new Error("最终溶液至少需要一个组分");
    const totalMl = total * UNIT_TO_ML[solution.total_unit];
    const ingredients = [];

    const allocate = (node, amountMl, path = []) => {
      if (!node.name.trim()) throw new Error("所有层级和组分都需要名称");
      if (!node.children.length) {
        ingredients.push({
          id: node.id,
          name: node.name,
          path: [...path, node.name],
          volumeMl: amountMl,
          fraction: amountMl / totalMl,
        });
        return;
      }
      const invalid = node.children.find((child) => !Number.isFinite(Number(child.ratio)) || Number(child.ratio) <= 0 || !child.name.trim());
      if (invalid) throw new Error(`“${invalid.name || "未命名节点"}”的名称和比例必须有效`);
      const sum = node.children.reduce((acc, child) => acc + Number(child.ratio), 0);
      if (sum <= 0) throw new Error(`“${node.name}”的同级比例合计必须大于 0`);
      const nextPath = node === solution.root ? path : [...path, node.name];
      node.children.forEach((child) => allocate(child, amountMl * Number(child.ratio) / sum, nextPath));
    };

    allocate(solution.root, totalMl);
    return { totalMl, ingredients, calculatedAt: new Date().toISOString() };
  };

  const solutionResultHtml = () => {
    if (!solution.calculated) {
      return `<div class="empty-state"><div><strong>尚未计算</strong>完成配方结构后，选择“计算最终用量”。</div></div>`;
    }
    return `
      <div class="ingredient-list">
        ${solution.calculated.ingredients
          .map((item) => {
            const unit = solution.outputUnits[item.id] || "mL";
            const value = item.volumeMl / UNIT_TO_ML[unit];
            return `
              <div class="ingredient-row">
                <div>
                  <strong>${e(item.name)}</strong>
                  <small>${e(item.path.join(" › "))} · 占总体积 ${numberText(item.fraction * 100, 4)}%</small>
                </div>
                <div class="ingredient-value">
                  <span>${numberText(value)}</span>
                  <label class="visually-hidden" for="unit-${item.id}">${e(item.name)}显示单位</label>
                  <select id="unit-${item.id}" data-output-unit="${item.id}">
                    ${UNITS.map((option) => `<option ${option === unit ? "selected" : ""}>${option}</option>`).join("")}
                  </select>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="alert info" style="margin-top:14px">当前仅进行纯体积比例计算，不校正密度、纯度、温度或混合体积收缩。</div>
    `;
  };

  const recipeRowsHtml = () =>
    walkNodes(solution.root)
      .map(({ node, depth, parent }) => {
        const isRoot = node === solution.root;
        const siblings = parent?.children || [];
        const siblingSum = siblings.reduce((sum, item) => sum + Number(item.ratio || 0), 0);
        const share = isRoot || siblingSum <= 0 ? "" : `${numberText(Number(node.ratio) / siblingSum * 100, 3)}%`;
        return `
          <div class="recipe-row ${solution.selectedId === node.id ? "selected" : ""}" style="--depth:${depth};--level-hue:${(214 + depth * 67) % 360}" data-node-id="${node.id}">
            <div class="row-main">
              <div class="row-title"><span>${depth ? "↳ " : ""}${e(node.name)}</span><span class="tag level-tag">第 ${depth + 1} 级</span>${node.children.length ? `<span class="tag info">中间相</span>` : `<span class="tag success">最终组分</span>`}</div>
              <div class="row-meta">${isRoot ? `${node.children.length} 个直属组分` : `比例 ${numberText(node.ratio)}${share ? ` · 同级占比 ${share}` : ""}`}</div>
            </div>
            <span class="tag neutral">${node.children.length ? `${node.children.length} 项` : "叶子"}</span>
            ${isRoot ? "" : `<div class="row-actions"><button class="mini-button" type="button" data-action="select-node" data-node-id="${node.id}" aria-label="编辑${e(node.name)}">编辑</button></div>`}
          </div>
        `;
      })
      .join("");

  const selectedEditorHtml = () => {
    const selected = findNode(solution.root, solution.selectedId);
    if (!selected || selected.node === solution.root) return `<div class="alert info">选择一个配方节点后，可在此编辑并在节点附近添加同级或下级。</div>`;
    return `
      <div class="inline-editor" aria-label="编辑选中节点">
        <div class="field">
          <label for="node-name">节点名称</label>
          <input id="node-name" value="${e(selected.node.name)}" data-solution-field="node-name">
        </div>
        <div class="field">
          <label for="node-ratio">相对比例</label>
          <input id="node-ratio" type="number" min="0" step="any" inputmode="decimal" value="${e(selected.node.ratio)}" data-solution-field="node-ratio">
        </div>
        <div class="button-row" style="align-self:end">
          <button class="button secondary" type="button" data-action="add-sibling">＋ 同级</button>
          <button class="button secondary" type="button" data-action="add-child">↳ 下级</button>
          <button class="button danger-button" type="button" data-action="delete-node">删除</button>
        </div>
      </div>
    `;
  };

  function updateSolutionStatus() {
    setBadge(saveStatus, `草稿已保存 · ${formatTime(new Date())}`, "success");
    if (solution.calculated) {
      setBadge(resultStatus, `${solution.calculated.ingredients.length} 项结果有效`, "success");
      statusContext.textContent = solution.name;
    } else {
      setBadge(resultStatus, "待计算", "neutral");
      statusContext.textContent = solution.name;
    }
  }

  function markSolutionDirty() {
    if (solution.calculated) {
      solution.calculated = null;
      setBadge(resultStatus, "输入已修改 · 待重新计算", "warning");
      const results = app.querySelector("#solution-results");
      if (results) results.innerHTML = solutionResultHtml();
      const copyButton = app.querySelector('[data-action="copy-solution-results"]');
      if (copyButton) copyButton.disabled = true;
    }
    scheduleSave("solution", { ...solution, calculated: null });
  }

  function renderSolution() {
    localStorage.setItem(STORAGE.recent, "solution");
    setShell({
      title: "溶液配制辅助",
      save: `草稿已保存 · ${formatTime()}`,
      saveKind: "success",
      result: solution.calculated ? `${solution.calculated.ingredients.length} 项结果有效` : "待计算",
      resultKind: solution.calculated ? "success" : "neutral",
      context: solution.name,
      menu: [
        { label: "新建空白配方", action: () => resetSolution(blankRecipe()) },
        { label: "加载示例配方", action: () => resetSolution(exampleRecipe()) },
        { label: "导入方案文件", action: importSolution },
        { label: "下载方案文件", action: exportSolution },
      ],
    });
    app.innerHTML = `
      <div class="page tool-page">
        <div class="page-heading">
          <div>
            <p class="eyebrow">VOLUME RECIPE</p>
            <h1>溶液配制辅助</h1>
            <p>按层级拆解体积比例；中间相继续分配，只有最终组分进入用量结果。</p>
          </div>
          <div class="button-row">
            <button class="button secondary" type="button" data-action="load-example">加载示例</button>
            <button class="button secondary" type="button" data-action="export-solution">下载方案文件</button>
          </div>
        </div>
        <section class="card" aria-labelledby="recipe-summary-title">
          <div class="card-heading">
            <div><h2 id="recipe-summary-title">配方摘要</h2><p>总体积变化后需要重新计算，结构和单位选择会保留。</p></div>
          </div>
          <div class="summary-grid">
            <div class="field">
              <label for="recipe-name">配方名称 <span class="required">*</span></label>
              <input id="recipe-name" value="${e(solution.name)}" data-solution-field="name">
            </div>
            <div class="field">
              <label for="total-volume">最终总体积 <span class="required">*</span></label>
              <input id="total-volume" type="number" min="0" step="any" inputmode="decimal" value="${e(solution.total_volume)}" data-solution-field="total-volume">
            </div>
            <div class="field">
              <label for="total-unit">单位</label>
              <select id="total-unit" data-solution-field="total-unit">${UNITS.map((unit) => `<option ${unit === solution.total_unit ? "selected" : ""}>${unit}</option>`).join("")}</select>
            </div>
            <div class="primary-action desktop-only">
              <button class="button primary" type="button" data-action="calculate-solution">计算最终用量</button>
            </div>
          </div>
        </section>
        <div class="workspace-grid">
          <div>
            <div class="tabs mobile-tabs" role="tablist" aria-label="溶液配制视图">
              <button type="button" role="tab" aria-selected="${ui.solutionTab === "structure"}" data-solution-tab="structure">配方结构</button>
              <button type="button" role="tab" aria-selected="${ui.solutionTab === "results"}" data-solution-tab="results">最终结果</button>
            </div>
            <section class="card mobile-tab-panel ${ui.solutionTab === "structure" ? "active" : ""}" id="solution-structure" aria-labelledby="structure-title">
              <div class="card-heading">
                <div><h2 id="structure-title">配方结构</h2><p>选择节点后就近编辑；同级比例会自动归一化。</p></div>
                <span class="tag neutral">${walkNodes(solution.root).length - 1} 个节点</span>
              </div>
              <div class="recipe-list">${recipeRowsHtml()}</div>
              <div id="selected-editor">${selectedEditorHtml()}</div>
            </section>
          </div>
          <aside class="card sticky-panel mobile-tab-panel ${ui.solutionTab === "results" ? "active" : ""}" id="solution-results-panel" aria-labelledby="results-title">
            <div class="card-heading">
              <div><h2 id="results-title">最终组分</h2><p>每项可独立切换显示单位。</p></div>
              <button class="button secondary" type="button" data-action="copy-solution-results" ${solution.calculated ? "" : "disabled"}>复制结果</button>
            </div>
            <div id="solution-results">${solutionResultHtml()}</div>
          </aside>
        </div>
      </div>
    `;

    setMobileAction(
      `<button class="button secondary" type="button" data-mobile-action="add">＋ 添加节点</button><button class="button primary" type="button" data-mobile-action="calculate">计算最终用量</button>`,
      (event) => {
        const action = event.target.closest("[data-mobile-action]")?.dataset.mobileAction;
        if (action === "calculate") runSolutionCalculation();
        if (action === "add") addSolutionNode("sibling");
      },
    );

    app.onclick = handleSolutionClick;
    app.oninput = handleSolutionInput;
    app.onchange = handleSolutionChange;
  }

  async function resetSolution(next) {
    const accepted = await confirmAction({
      title: "替换当前配方？",
      body: "<p>当前草稿会被新配方替换。若需保留，请先下载方案文件。</p>",
      confirmText: "替换配方",
    });
    if (!accepted) return;
    solution = next;
    solution.selectedId ||= solution.root.children[0]?.id || null;
    localStorage.setItem(STORAGE.solution, JSON.stringify(solution));
    renderSolution();
  }

  function handleSolutionClick(event) {
    const tab = event.target.closest("[data-solution-tab]");
    if (tab) {
      ui.solutionTab = tab.dataset.solutionTab;
      renderSolution();
      return;
    }
    const row = event.target.closest(".recipe-row");
    if (row && !event.target.closest("button") && row.dataset.nodeId !== solution.root.id) {
      solution.selectedId = row.dataset.nodeId;
      renderSolution();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "select-node") {
      solution.selectedId = event.target.closest("[data-node-id]").dataset.nodeId;
      renderSolution();
    } else if (action === "add-sibling") {
      addSolutionNode("sibling");
    } else if (action === "add-child") {
      addSolutionNode("child");
    } else if (action === "delete-node") {
      deleteSolutionNode();
    } else if (action === "calculate-solution") {
      runSolutionCalculation();
    } else if (action === "load-example") {
      resetSolution(exampleRecipe());
    } else if (action === "export-solution") {
      exportSolution();
    } else if (action === "copy-solution-results") {
      copySolutionResults();
    }
  }

  function handleSolutionInput(event) {
    const field = event.target.dataset.solutionField;
    if (!field) return;
    if (field === "name") solution.name = event.target.value;
    if (field === "total-volume") solution.total_volume = event.target.value;
    if (field === "node-name" || field === "node-ratio") {
      const selected = findNode(solution.root, solution.selectedId)?.node;
      if (selected) {
        if (field === "node-name") selected.name = event.target.value;
        if (field === "node-ratio") selected.ratio = event.target.value;
      }
    }
    markSolutionDirty();
  }

  function handleSolutionChange(event) {
    if (event.target.dataset.solutionField === "total-unit") {
      solution.total_unit = event.target.value;
      markSolutionDirty();
    }
    const id = event.target.dataset.outputUnit;
    if (id) {
      solution.outputUnits[id] = event.target.value;
      scheduleSave("solution", { ...solution, calculated: null });
      app.querySelector("#solution-results").innerHTML = solutionResultHtml();
    }
  }

  function addSolutionNode(mode) {
    const selected = findNode(solution.root, solution.selectedId);
    if (!selected || selected.node === solution.root) {
      toast("请先选择一个配方节点", { kind: "warning" });
      return;
    }
    const node = { id: uid(), name: mode === "child" ? "新下级组分" : "新同级组分", ratio: 1, children: [] };
    if (mode === "child") {
      selected.node.children.push(node);
    } else {
      selected.parent.children.push(node);
    }
    solution.selectedId = node.id;
    markSolutionDirty();
    renderSolution();
    requestAnimationFrame(() => app.querySelector("#node-name")?.select());
  }

  async function deleteSolutionNode() {
    const selected = findNode(solution.root, solution.selectedId);
    if (!selected || !selected.parent) return;
    const childCount = walkNodes(selected.node).length - 1;
    const accepted = await confirmAction({
      eyebrow: "危险操作",
      title: `删除“${selected.node.name}”？`,
      body: `<p>${childCount ? `该中间相包含 ${childCount} 个下级节点，将一并删除。` : "该最终组分将从配方中移除。"}</p>`,
      confirmText: "删除",
      danger: true,
    });
    if (!accepted) return;
    const index = selected.parent.children.indexOf(selected.node);
    const snapshot = structuredClone(selected.node);
    selected.parent.children.splice(index, 1);
    solution.selectedId = selected.parent === solution.root ? selected.parent.children[0]?.id || null : selected.parent.id;
    markSolutionDirty();
    renderSolution();
    toast(`已删除“${snapshot.name}”`, {
      actionLabel: "撤销",
      onAction: () => {
        selected.parent.children.splice(index, 0, snapshot);
        solution.selectedId = snapshot.id;
        markSolutionDirty();
        renderSolution();
      },
    });
  }

  function runSolutionCalculation() {
    try {
      solution.calculated = calculateRecipe();
      localStorage.setItem(STORAGE.solution, JSON.stringify({ ...solution, calculated: null }));
      setBadge(resultStatus, `${solution.calculated.ingredients.length} 项结果有效`, "success");
      const results = app.querySelector("#solution-results");
      if (results) results.innerHTML = solutionResultHtml();
      ui.solutionTab = "results";
      toast(`已计算 ${solution.calculated.ingredients.length} 个最终组分`);
      if (matchMedia("(max-width: 767px)").matches) renderSolution();
    } catch (error) {
      setBadge(resultStatus, "存在输入错误", "danger");
      toast(error.message, { kind: "error" });
      app.querySelector('[aria-invalid="true"]')?.focus();
    }
  }

  function copySolutionResults() {
    if (!solution.calculated) return;
    const lines = solution.calculated.ingredients.map((item) => {
      const unit = solution.outputUnits[item.id] || "mL";
      return `${item.name}：${numberText(item.volumeMl / UNIT_TO_ML[unit])} ${unit}`;
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => toast(`已复制 ${lines.length} 项最终组分用量`));
  }

  function exportSolution() {
    const payload = { ...solution, calculated: undefined, selectedId: undefined, outputUnits: undefined };
    download(`${solution.name || "实验室配方"}.labrecipe.json`, JSON.stringify(payload, null, 2));
    toast(`已下载“${solution.name || "实验室配方"}”方案文件`);
  }

  function importSolution() {
    openFile(async (text, filename) => {
      const payload = JSON.parse(text);
      if (payload.format !== "lab-calculator-recipe" || !payload.root?.children) throw new Error("该文件不是有效的溶液配方方案");
      const accepted = await confirmAction({
        title: "导入配方方案？",
        body: `<p>文件：<strong>${e(filename)}</strong></p><p>方案名称：${e(payload.name || "未命名配方")}；包含 ${walkNodes(payload.root).length - 1} 个节点。导入后会替换当前草稿。</p>`,
        confirmText: "导入并替换",
      });
      if (!accepted) return;
      solution = { ...payload, calculated: null, selectedId: payload.root.children[0]?.id || null, outputUnits: {} };
      localStorage.setItem(STORAGE.solution, JSON.stringify(solution));
      renderSolution();
      toast(`已导入“${solution.name}”`);
    });
  }

  const CONCENTRATION_VOLUME_TO_L = { "µL": 0.000001, mL: 0.001, L: 1 };
  const MOLAR_TO_MOL_L = { "mol/L": 1, "mmol/L": 0.001, "µmol/L": 0.000001 };
  const MASS_TO_G_L = { "g/L": 1, "mg/mL": 1, "mg/L": 0.001, "µg/mL": 0.001, "% w/v": 10 };
  const SOLID_CONCENTRATION_UNITS = [...Object.keys(MOLAR_TO_MOL_L), ...Object.keys(MASS_TO_G_L)];
  const LIQUID_CONCENTRATION_UNITS = ["mol/L", "mmol/L", "g/L", "mg/mL", "% w/v"];
  const CONCENTRATION_MODES = {
    solid: "固体试剂配液",
    liquid: "液体试剂配液",
    dilution: "母液稀释",
  };

  const defaultConcentration = () => ({
    mode: "solid",
    name: "新配制方案",
    substance: "",
    targetConcentration: "",
    targetUnit: "mol/L",
    targetVolume: "",
    volumeUnit: "mL",
    molecularWeight: "",
    purity: "100",
    density: "",
    stockConcentration: "",
    stockUnit: "mol/L",
    portions: "1",
    extraPercent: "0",
    notes: "",
  });

  let concentration = {
    ...defaultConcentration(),
    ...safeParse(localStorage.getItem(STORAGE.concentration), {}),
    result: null,
    errors: {},
    stale: false,
  };
  if (!CONCENTRATION_MODES[concentration.mode]) concentration = { ...defaultConcentration(), result: null, errors: {}, stale: false };

  const concentrationDimension = (unit) => {
    if (Object.hasOwn(MOLAR_TO_MOL_L, unit)) return "molar";
    if (Object.hasOwn(MASS_TO_G_L, unit)) return "mass";
    return "";
  };

  const requiredNumber = (value, field, { positive = true, minimum = null, integer = false } = {}) => {
    if (value === "" || value == null) throw { field, message: `请填写${field}` };
    const number = Number(value);
    if (!Number.isFinite(number)) throw { field, message: `${field}必须是有限数字` };
    if (positive && number <= 0) throw { field, message: `${field}必须大于 0` };
    if (minimum != null && number < minimum) throw { field, message: `${field}不能小于 ${minimum}` };
    if (integer && !Number.isInteger(number)) throw { field, message: `${field}必须是大于 0 的整数` };
    return number;
  };

  const requireText = (value, field) => {
    if (!String(value || "").trim()) throw { field, message: `请填写${field}` };
    return String(value).trim();
  };

  const purityFraction = () => {
    const purity = requiredNumber(concentration.purity, "试剂纯度");
    if (purity > 100) throw { field: "试剂纯度", message: "试剂纯度必须大于 0% 且不超过 100%" };
    return purity / 100;
  };

  const volumeInLitres = () => {
    const volume = requiredNumber(concentration.targetVolume, "目标体积");
    const factor = CONCENTRATION_VOLUME_TO_L[concentration.volumeUnit];
    if (!factor) throw { field: "体积单位", message: "请选择有效的体积单位" };
    return volume * factor;
  };

  const ensureFiniteResult = (values) => {
    if (values.some((value) => !Number.isFinite(value))) throw { field: "计算结果", message: "计算结果不是有限数字，请核对所有输入" };
  };

  const concentrationInBase = (value, unit) => {
    const dimension = concentrationDimension(unit);
    if (!dimension) throw { field: "浓度单位", message: "请选择有效的浓度单位" };
    return value * (dimension === "molar" ? MOLAR_TO_MOL_L[unit] : MASS_TO_G_L[unit]);
  };

  const formatMass = (grams) => {
    if (grams >= 1000) return `${numberText(grams / 1000)} kg`;
    if (grams >= 1) return `${numberText(grams)} g`;
    if (grams >= 0.001) return `${numberText(grams * 1000)} mg`;
    return `${numberText(grams * 1_000_000)} µg`;
  };

  const formatVolumeL = (litres) => {
    if (litres >= 1) return `${numberText(litres)} L`;
    if (litres >= 0.001) return `${numberText(litres * 1000)} mL`;
    return `${numberText(litres * 1_000_000)} µL`;
  };

  const calculateSolidConcentration = () => {
    const target = requiredNumber(concentration.targetConcentration, "目标浓度");
    const volumeL = volumeInLitres();
    const purity = purityFraction();
    const dimension = concentrationDimension(concentration.targetUnit);
    if (!dimension) throw { field: "浓度单位", message: "请选择有效的浓度单位" };
    let amountMol = null;
    let pureMassG;
    const formulas = [
      `体积换算：${numberText(Number(concentration.targetVolume))} ${concentration.volumeUnit} = ${numberText(volumeL)} L`,
    ];
    if (dimension === "molar") {
      const molecularWeight = requiredNumber(concentration.molecularWeight, "分子量");
      const molL = concentrationInBase(target, concentration.targetUnit);
      amountMol = molL * volumeL;
      pureMassG = amountMol * molecularWeight;
      formulas.push(
        `浓度换算：${numberText(target)} ${concentration.targetUnit} = ${numberText(molL)} mol/L`,
        `n = C × V = ${numberText(molL)} mol/L × ${numberText(volumeL)} L = ${numberText(amountMol)} mol`,
        `m纯品 = n × M = ${numberText(amountMol)} mol × ${numberText(molecularWeight)} g/mol = ${numberText(pureMassG)} g`,
      );
    } else {
      const gL = concentrationInBase(target, concentration.targetUnit);
      pureMassG = gL * volumeL;
      formulas.push(
        `质量浓度换算：${numberText(target)} ${concentration.targetUnit} = ${numberText(gL)} g/L`,
        `m纯品 = C × V = ${numberText(gL)} g/L × ${numberText(volumeL)} L = ${numberText(pureMassG)} g`,
      );
    }
    const actualMassG = pureMassG / purity;
    formulas.push(
      `纯度小数 = ${numberText(Number(concentration.purity))}% ÷ 100 = ${numberText(purity)}`,
      `m实际称量 = m纯品 ÷ 纯度小数 = ${numberText(pureMassG)} g ÷ ${numberText(purity)} = ${numberText(actualMassG)} g`,
    );
    ensureFiniteResult([pureMassG, actualMassG, ...(amountMol == null ? [] : [amountMol])]);
    const warnings = ["请核对纯度和分子量是否对应试剂的实际盐型、水合物或溶剂化物。"];
    if (actualMassG < 0.01) warnings.push("称量量小于 10 mg，建议核对天平能力或考虑配制中间液。");
    return {
      mode: "solid",
      calculatedAt: new Date().toISOString(),
      metrics: [
        ["实际称量量", formatMass(actualMassG)],
        ["纯品理论量", formatMass(pureMassG)],
        ...(amountMol == null ? [] : [["物质的量", `${numberText(amountMol)} mol`]]),
        ["纯度修正系数", numberText(1 / purity)],
      ],
      formulas,
      steps: [
        `称取 ${formatMass(actualMassG)} 的${concentration.substance.trim()}。`,
        `加入约目标体积 60%～80% 的适用溶剂溶解。`,
        `完全溶解并恢复至适用温度后，用溶剂定容至 ${numberText(Number(concentration.targetVolume))} ${concentration.volumeUnit}。`,
        "混匀并按实验室要求记录。",
      ],
      warnings,
    };
  };

  const calculateLiquidConcentration = () => {
    const target = requiredNumber(concentration.targetConcentration, "目标浓度");
    const volumeL = volumeInLitres();
    const purity = purityFraction();
    const density = requiredNumber(concentration.density, "试剂密度");
    const dimension = concentrationDimension(concentration.targetUnit);
    if (!dimension || !LIQUID_CONCENTRATION_UNITS.includes(concentration.targetUnit)) {
      throw { field: "浓度单位", message: "请选择液体试剂模式支持的浓度单位" };
    }
    let amountMol = null;
    let pureMassG;
    const formulas = [`体积换算：${numberText(Number(concentration.targetVolume))} ${concentration.volumeUnit} = ${numberText(volumeL)} L`];
    if (dimension === "molar") {
      const molecularWeight = requiredNumber(concentration.molecularWeight, "分子量");
      const molL = concentrationInBase(target, concentration.targetUnit);
      amountMol = molL * volumeL;
      pureMassG = amountMol * molecularWeight;
      formulas.push(
        `浓度换算：${numberText(target)} ${concentration.targetUnit} = ${numberText(molL)} mol/L`,
        `m纯品 = C × V × M = ${numberText(molL)} mol/L × ${numberText(volumeL)} L × ${numberText(molecularWeight)} g/mol = ${numberText(pureMassG)} g`,
      );
    } else {
      const gL = concentrationInBase(target, concentration.targetUnit);
      pureMassG = gL * volumeL;
      formulas.push(
        `质量浓度换算：${numberText(target)} ${concentration.targetUnit} = ${numberText(gL)} g/L`,
        `m纯品 = 质量浓度 × V = ${numberText(gL)} g/L × ${numberText(volumeL)} L = ${numberText(pureMassG)} g`,
      );
    }
    const reagentMassG = pureMassG / purity;
    const reagentVolumeMl = reagentMassG / density;
    formulas.push(
      `m试剂溶液 = m纯品 ÷ 纯度小数 = ${numberText(pureMassG)} g ÷ ${numberText(purity)} = ${numberText(reagentMassG)} g`,
      `V试剂溶液 = m试剂溶液 ÷ 密度 = ${numberText(reagentMassG)} g ÷ ${numberText(density)} g/mL = ${numberText(reagentVolumeMl)} mL`,
    );
    ensureFiniteResult([pureMassG, reagentMassG, reagentVolumeMl, ...(amountMol == null ? [] : [amountMol])]);
    const warnings = [
      "密度必须与试剂标签、纯度和适用温度相匹配；系统不自动推断密度。",
      "涉及腐蚀性或放热性试剂时，应遵循试剂SDS和实验室SOP，并根据具体试剂确定加料顺序。",
    ];
    if (reagentVolumeMl < 0.01) warnings.push("移取体积小于 10 µL，建议核对移液设备能力或考虑配制中间液。");
    return {
      mode: "liquid",
      calculatedAt: new Date().toISOString(),
      metrics: [
        ["浓试剂移取体积", formatVolumeL(reagentVolumeMl / 1000)],
        ["试剂溶液质量", formatMass(reagentMassG)],
        ["所含纯品质量", formatMass(pureMassG)],
        ...(amountMol == null ? [] : [["物质的量", `${numberText(amountMol)} mol`]]),
      ],
      formulas,
      steps: [
        `按试剂标签、纯度和适用温度复核密度 ${numberText(density)} g/mL。`,
        `量取 ${formatVolumeL(reagentVolumeMl / 1000)} 的${concentration.substance.trim()}。`,
        `按该试剂 SDS 和实验室 SOP 确定加料顺序，转移后用适用溶剂稀释并定容至 ${numberText(Number(concentration.targetVolume))} ${concentration.volumeUnit}。`,
        "混匀并按实验室要求记录。",
      ],
      warnings,
    };
  };

  const calculateDilution = () => {
    const stock = requiredNumber(concentration.stockConcentration, "母液浓度");
    const target = requiredNumber(concentration.targetConcentration, "目标浓度");
    const volumeL = volumeInLitres();
    const portions = requiredNumber(concentration.portions, "配制份数", { integer: true });
    const extra = requiredNumber(concentration.extraPercent, "额外余量", { positive: false, minimum: 0 });
    const stockDimension = concentrationDimension(concentration.stockUnit);
    const targetDimension = concentrationDimension(concentration.targetUnit);
    if (!stockDimension || stockDimension !== targetDimension) {
      throw { field: "浓度单位", message: "母液与目标浓度的单位维度不兼容，请选择同一浓度维度" };
    }
    const stockBase = concentrationInBase(stock, concentration.stockUnit);
    const targetBase = concentrationInBase(target, concentration.targetUnit);
    if (stockBase <= targetBase) throw { field: "母液浓度", message: "母液浓度必须高于目标浓度" };
    const stockVolumeL = targetBase * volumeL / stockBase;
    if (stockVolumeL >= volumeL) throw { field: "母液移取量", message: "母液移取量必须小于目标终体积" };
    const solventDifferenceL = volumeL - stockVolumeL;
    const totalStockL = stockVolumeL * portions;
    const totalFinalL = volumeL * portions;
    const multiplier = portions * (1 + extra / 100);
    const plannedStockL = stockVolumeL * multiplier;
    const plannedFinalL = volumeL * multiplier;
    const plannedSolventDifferenceL = plannedFinalL - plannedStockL;
    ensureFiniteResult([stockVolumeL, solventDifferenceL, totalStockL, totalFinalL, plannedStockL, plannedFinalL]);
    const warnings = ["理论溶剂差值仅用于复核；混合可能发生体积变化，实际操作应稀释并定容至目标体积。"];
    if (stockVolumeL < 0.00001) warnings.push("移取体积小于 10 µL，建议核对移液设备能力或考虑配制中间液。");
    if (stockVolumeL / volumeL >= 0.9) warnings.push("母液移取体积非常接近目标终体积，请核对浓度与设备量程。");
    return {
      mode: "dilution",
      calculatedAt: new Date().toISOString(),
      metrics: [
        ["单份母液移取量", formatVolumeL(stockVolumeL)],
        ["单份目标终体积", formatVolumeL(volumeL)],
        ["全部份数母液合计", formatVolumeL(totalStockL)],
        ["加余量后计划母液量", formatVolumeL(plannedStockL)],
        ["加余量后计划终体积", formatVolumeL(plannedFinalL)],
        ["单份理论溶剂差值", formatVolumeL(solventDifferenceL)],
        ["计划理论溶剂差值", formatVolumeL(plannedSolventDifferenceL)],
      ],
      formulas: [
        `浓度基准换算：C1 = ${numberText(stockBase)} ${stockDimension === "molar" ? "mol/L" : "g/L"}；C2 = ${numberText(targetBase)} ${stockDimension === "molar" ? "mol/L" : "g/L"}`,
        `单份 V1 = C2 × V2 ÷ C1 = ${numberText(targetBase)} × ${numberText(volumeL)} L ÷ ${numberText(stockBase)} = ${numberText(stockVolumeL)} L`,
        `单份理论溶剂差值 = V2 - V1 = ${numberText(volumeL)} L - ${numberText(stockVolumeL)} L = ${numberText(solventDifferenceL)} L`,
        `计划倍数 = ${portions} 份 × (1 + ${numberText(extra)}% ÷ 100) = ${numberText(multiplier)}`,
        `计划母液体积 = ${numberText(stockVolumeL)} L × ${numberText(multiplier)} = ${numberText(plannedStockL)} L`,
        `计划终体积 = ${numberText(volumeL)} L × ${numberText(multiplier)} = ${numberText(plannedFinalL)} L`,
      ],
      steps: [
        `单份量取 ${formatVolumeL(stockVolumeL)} 的${concentration.substance.trim()}；共 ${portions} 份。`,
        `如按 ${numberText(extra)}% 余量统一准备，计划量取母液 ${formatVolumeL(plannedStockL)}。`,
        `加入部分适用溶剂混匀，再用溶剂稀释并定容至${portions === 1 ? `目标体积 ${formatVolumeL(volumeL)}` : `每份目标体积 ${formatVolumeL(volumeL)}`}。`,
        "混匀并按实验室要求记录；不要把理论溶剂差值当作实际精确加入量。",
      ],
      warnings,
    };
  };

  const concentrationDraft = () => {
    const data = { ...concentration };
    delete data.result;
    delete data.errors;
    delete data.stale;
    return data;
  };

  const fieldError = (field) => concentration.errors[field] ? `<span class="field-error">${e(concentration.errors[field])}</span>` : "";
  const invalid = (field) => concentration.errors[field] ? 'aria-invalid="true"' : "";
  const optionList = (units, selected) => units.map((unit) => `<option value="${unit}" ${unit === selected ? "selected" : ""}>${unit}</option>`).join("");

  const concentrationFieldsHtml = () => {
    const molecularRequired = concentrationDimension(concentration.targetUnit) === "molar";
    if (concentration.mode === "dilution") {
      return `
        <div class="concentration-fields">
          <div class="field"><label for="stock-concentration">母液浓度 C1 <span class="required">*</span></label><div class="input-group"><input id="stock-concentration" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.stockConcentration)}" data-concentration-field="stockConcentration" data-error-field="母液浓度" ${invalid("母液浓度")}><select aria-label="母液浓度单位" data-concentration-field="stockUnit">${optionList(SOLID_CONCENTRATION_UNITS, concentration.stockUnit)}</select></div>${fieldError("母液浓度")}</div>
          <div class="field"><label for="target-concentration">目标浓度 C2 <span class="required">*</span></label><div class="input-group"><input id="target-concentration" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.targetConcentration)}" data-concentration-field="targetConcentration" data-error-field="目标浓度" ${invalid("目标浓度")}><select aria-label="目标浓度单位" data-concentration-field="targetUnit">${optionList(SOLID_CONCENTRATION_UNITS, concentration.targetUnit)}</select></div>${fieldError("目标浓度")}${fieldError("浓度单位")}</div>
          <div class="field"><label for="target-volume">单份目标终体积 V2 <span class="required">*</span></label><div class="input-group"><input id="target-volume" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.targetVolume)}" data-concentration-field="targetVolume" data-error-field="目标体积" ${invalid("目标体积")}><select aria-label="体积单位" data-concentration-field="volumeUnit">${optionList(Object.keys(CONCENTRATION_VOLUME_TO_L), concentration.volumeUnit)}</select></div>${fieldError("目标体积")}</div>
          <div class="field"><label for="portions">配制份数 <span class="required">*</span></label><input id="portions" type="number" min="1" step="1" inputmode="numeric" value="${e(concentration.portions)}" data-concentration-field="portions" data-error-field="配制份数" ${invalid("配制份数")}>${fieldError("配制份数")}</div>
          <div class="field"><label for="extra-percent">额外余量</label><div class="input-group"><input id="extra-percent" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.extraPercent)}" data-concentration-field="extraPercent" data-error-field="额外余量" ${invalid("额外余量")}><span class="input-suffix">%</span></div>${fieldError("额外余量")}</div>
        </div>
      `;
    }
    const units = concentration.mode === "liquid" ? LIQUID_CONCENTRATION_UNITS : SOLID_CONCENTRATION_UNITS;
    return `
      <div class="concentration-fields">
        <div class="field"><label for="target-concentration">目标浓度 <span class="required">*</span></label><div class="input-group"><input id="target-concentration" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.targetConcentration)}" data-concentration-field="targetConcentration" data-error-field="目标浓度" ${invalid("目标浓度")}><select aria-label="目标浓度单位" data-concentration-field="targetUnit">${optionList(units, concentration.targetUnit)}</select></div>${fieldError("目标浓度")}${fieldError("浓度单位")}</div>
        <div class="field"><label for="target-volume">目标体积 <span class="required">*</span></label><div class="input-group"><input id="target-volume" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.targetVolume)}" data-concentration-field="targetVolume" data-error-field="目标体积" ${invalid("目标体积")}><select aria-label="体积单位" data-concentration-field="volumeUnit">${optionList(Object.keys(CONCENTRATION_VOLUME_TO_L), concentration.volumeUnit)}</select></div>${fieldError("目标体积")}</div>
        <div class="field"><label for="molecular-weight">分子量 ${molecularRequired ? '<span class="required">*</span>' : ""}</label><div class="input-group"><input id="molecular-weight" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.molecularWeight)}" data-concentration-field="molecularWeight" data-error-field="分子量" ${invalid("分子量")}><span class="input-suffix">g/mol</span></div><span class="field-help">${molecularRequired ? "摩尔浓度计算必填；请按实际盐型或水合物填写。" : "质量浓度计算不使用分子量。"}</span>${fieldError("分子量")}</div>
        <div class="field"><label for="purity">试剂纯度 <span class="required">*</span></label><div class="input-group"><input id="purity" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(concentration.purity)}" data-concentration-field="purity" data-error-field="试剂纯度" ${invalid("试剂纯度")}><span class="input-suffix">${concentration.mode === "liquid" ? "% w/w" : "%"}</span></div>${fieldError("试剂纯度")}</div>
        ${concentration.mode === "liquid" ? `<div class="field"><label for="density">试剂密度 <span class="required">*</span></label><div class="input-group"><input id="density" type="number" min="0" step="any" inputmode="decimal" value="${e(concentration.density)}" data-concentration-field="density" data-error-field="试剂密度" ${invalid("试剂密度")}><span class="input-suffix">g/mL</span></div><span class="field-help">必须与试剂标签、纯度和适用温度匹配，系统不自动推断。</span>${fieldError("试剂密度")}</div>` : ""}
      </div>
    `;
  };

  const concentrationInputSummary = () => {
    const items = [
      `方案名称：${concentration.name}`,
      `${concentration.mode === "dilution" ? "物质或母液名称" : "试剂名称"}：${concentration.substance}`,
    ];
    if (concentration.mode === "dilution") {
      items.push(
        `母液浓度 C1：${concentration.stockConcentration} ${concentration.stockUnit}`,
        `目标浓度 C2：${concentration.targetConcentration} ${concentration.targetUnit}`,
        `单份目标终体积：${concentration.targetVolume} ${concentration.volumeUnit}`,
        `配制份数：${concentration.portions}`,
        `额外余量：${concentration.extraPercent}%`,
      );
    } else {
      items.push(
        `目标浓度：${concentration.targetConcentration} ${concentration.targetUnit}`,
        `目标体积：${concentration.targetVolume} ${concentration.volumeUnit}`,
        `分子量：${concentration.molecularWeight || "不适用"}${concentration.molecularWeight ? " g/mol" : ""}`,
        `试剂纯度：${concentration.purity}%${concentration.mode === "liquid" ? " w/w" : ""}`,
      );
      if (concentration.mode === "liquid") items.push(`试剂密度：${concentration.density} g/mL`);
    }
    items.push(`备注：${concentration.notes.trim() || "无"}`);
    return items;
  };

  const concentrationResultsHtml = () => {
    if (!concentration.result) {
      const text = concentration.stale ? "输入已修改 · 待重新计算" : "填写左侧参数后生成称量、移取或稀释方案。";
      return `<div class="empty-state ${concentration.stale ? "stale-result" : ""}"><div><strong>${concentration.stale ? "结果已过期" : "尚未计算"}</strong>${text}</div></div>`;
    }
    const result = concentration.result;
    return `
      <div class="result-meta"><span class="tag success">结果有效</span><span>计算时间：${new Date(result.calculatedAt).toLocaleString("zh-CN")}</span></div>
      <div class="metric-grid">${result.metrics.map(([label, value]) => `<div class="metric"><small>${e(label)}</small><strong>${e(value)}</strong></div>`).join("")}</div>
      <section class="result-section"><h3>输入摘要</h3><ul>${concentrationInputSummary().map((item) => `<li>${e(item)}</li>`).join("")}</ul></section>
      <section class="result-section"><h3>计算依据与数值代入</h3><ol class="formula-list">${result.formulas.map((formula) => `<li>${e(formula)}</li>`).join("")}</ol></section>
      <section class="result-section"><h3>建议配制步骤</h3><ol>${result.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol></section>
      <section class="result-section"><h3>风险和核对事项</h3>${result.warnings.map((warning) => `<div class="alert warning">${e(warning)}</div>`).join("")}<div class="alert info">本功能只提供理论计算和操作辅助，不代替实验室SOP、药典、注册标准、试剂标签或经批准的方法。</div></section>
      <div class="button-row result-actions">
        <button class="button secondary" type="button" data-action="copy-concentration">复制完整配制方案</button>
        <button class="button secondary" type="button" data-action="print-concentration">打印配制方案</button>
      </div>
    `;
  };

  function renderConcentration() {
    localStorage.setItem(STORAGE.recent, "concentration");
    const valid = Boolean(concentration.result);
    setShell({
      title: "浓度与稀释配制辅助",
      save: "数据保存在当前浏览器",
      saveKind: "neutral",
      result: valid ? "计算结果有效" : concentration.stale ? "输入已修改 · 待重新计算" : Object.keys(concentration.errors).length ? "存在输入错误" : "尚无计算结果",
      resultKind: valid ? "success" : concentration.stale ? "warning" : Object.keys(concentration.errors).length ? "danger" : "neutral",
      context: concentration.name || "未命名方案",
      menu: [
        { label: "导入方案", action: importConcentration },
        { label: "下载方案 JSON", action: exportConcentration },
        { label: "打印配制方案", action: printConcentration },
      ],
    });
    setMobileAction('<button class="button primary" type="button" data-mobile-action="calculate-concentration">计算并生成配制方案</button>', (event) => {
      if (event.target.closest('[data-mobile-action="calculate-concentration"]')) runConcentrationCalculation();
    });
    app.innerHTML = `
      <div class="page tool-page concentration-page">
        <div class="page-heading">
          <div><p class="eyebrow">CONCENTRATION & DILUTION</p><h1>浓度与稀释配制辅助</h1><p>根据目标浓度、体积和试剂信息，计算称量量、浓试剂取用量或母液稀释量。</p></div>
          <div class="button-row">
            <button class="button secondary" type="button" data-action="import-concentration">导入方案</button>
            <button class="button secondary" type="button" data-action="export-concentration">下载方案 JSON</button>
          </div>
        </div>
        <div class="alert warning"><strong>科学性边界</strong><p>系统不会猜测分子量、密度、纯度或危险性。所有结果必须结合试剂标签、SDS、实验室 SOP、药典、注册标准或已批准方法复核。</p></div>
        <section class="card">
          <div class="card-heading"><div><h2>选择计算模式</h2><p>三种模式互斥；切换模式会保留已填写的通用字段，并要求重新计算。</p></div></div>
          <div class="segmented concentration-mode" role="group" aria-label="计算模式">
            ${Object.entries(CONCENTRATION_MODES).map(([mode, label]) => `<button type="button" data-concentration-mode="${mode}" aria-pressed="${String(concentration.mode === mode)}">${label}</button>`).join("")}
          </div>
        </section>
        <div class="workspace-grid concentration-workspace">
          <section class="card" aria-labelledby="concentration-input-title">
            <div class="card-heading"><div><h2 id="concentration-input-title">主要输入</h2><p>带 <span class="required">*</span> 的字段必须填写；不会在输入过程中反复弹窗。</p></div></div>
            <div class="two-column-fields concentration-common-fields">
              <div class="field"><label for="concentration-name">方案名称 <span class="required">*</span></label><input id="concentration-name" value="${e(concentration.name)}" data-concentration-field="name" data-error-field="方案名称" ${invalid("方案名称")}>${fieldError("方案名称")}</div>
              <div class="field"><label for="concentration-substance">${concentration.mode === "dilution" ? "物质或母液名称" : "试剂名称"} <span class="required">*</span></label><input id="concentration-substance" value="${e(concentration.substance)}" data-concentration-field="substance" data-error-field="物质名称" ${invalid("物质名称")}>${fieldError("物质名称")}</div>
            </div>
            ${concentrationFieldsHtml()}
            <div class="field concentration-notes"><label for="concentration-notes">备注</label><textarea id="concentration-notes" rows="3" data-concentration-field="notes">${e(concentration.notes)}</textarea></div>
            ${Object.entries(concentration.errors).filter(([field]) => !["方案名称", "物质名称", "目标浓度", "目标体积", "分子量", "试剂纯度", "试剂密度", "母液浓度", "配制份数", "额外余量", "浓度单位"].includes(field)).map(([, message]) => `<div class="alert danger">${e(message)}</div>`).join("")}
            <div class="button-row desktop-only concentration-primary"><button class="button primary" type="button" data-action="calculate-concentration">计算并生成配制方案</button></div>
          </section>
          <aside class="card sticky-panel" aria-labelledby="concentration-result-title">
            <div class="card-heading"><div><h2 id="concentration-result-title">结果与配制方案</h2><p>${valid ? "结果包含完整公式、步骤和风险核对。" : "输入修改后必须重新计算，过期结果不能复制或打印。"}</p></div></div>
            <div id="concentration-results">${concentrationResultsHtml()}</div>
          </aside>
        </div>
        <section class="card concentration-storage">
          <div class="card-heading"><div><h2>保存与导出</h2><p>数据保存在当前浏览器。重要方案请下载 <code>.labconcentration.json</code> 文件留存。</p></div></div>
          <div class="button-row">
            <button class="button secondary" type="button" data-action="export-concentration">下载方案 JSON</button>
            <button class="button secondary" type="button" data-action="import-concentration">导入方案文件</button>
            <button class="button secondary" type="button" data-action="copy-concentration" ${valid ? "" : "disabled"}>复制完整配制方案</button>
            <button class="button secondary" type="button" data-action="print-concentration" ${valid ? "" : "disabled"}>打印配制方案</button>
          </div>
        </section>
      </div>
    `;
    app.oninput = handleConcentrationInput;
    app.onchange = handleConcentrationChange;
    app.onclick = handleConcentrationClick;
  }

  function markConcentrationDirty(field = "") {
    if (field) delete concentration.errors[field];
    const hadResult = Boolean(concentration.result);
    concentration.result = null;
    concentration.stale ||= hadResult;
    setBadge(resultStatus, concentration.stale ? "输入已修改 · 待重新计算" : "尚无计算结果", concentration.stale ? "warning" : "neutral");
    scheduleSave("concentration", concentrationDraft());
    const results = app.querySelector("#concentration-results");
    if (results) results.innerHTML = concentrationResultsHtml();
    app.querySelectorAll('[data-action="copy-concentration"], [data-action="print-concentration"]').forEach((button) => {
      button.disabled = true;
    });
  }

  function handleConcentrationInput(event) {
    const key = event.target.dataset.concentrationField;
    if (!key) return;
    concentration[key] = event.target.value;
    const errorField = event.target.dataset.errorField;
    if (errorField) {
      delete concentration.errors[errorField];
      event.target.removeAttribute("aria-invalid");
      event.target.parentElement.parentElement.querySelector(".field-error")?.remove();
    }
    markConcentrationDirty();
  }

  function handleConcentrationChange(event) {
    const key = event.target.dataset.concentrationField;
    if (!key || event.target.tagName !== "SELECT") return;
    concentration[key] = event.target.value;
    if (key === "targetUnit" && concentration.mode === "liquid" && !LIQUID_CONCENTRATION_UNITS.includes(concentration.targetUnit)) {
      concentration.targetUnit = "mol/L";
    }
    markConcentrationDirty("浓度单位");
    renderConcentration();
  }

  function handleConcentrationClick(event) {
    const modeButton = event.target.closest("[data-concentration-mode]");
    if (modeButton) {
      concentration.mode = modeButton.dataset.concentrationMode;
      if (concentration.mode === "liquid" && !LIQUID_CONCENTRATION_UNITS.includes(concentration.targetUnit)) concentration.targetUnit = "mol/L";
      concentration.errors = {};
      markConcentrationDirty();
      renderConcentration();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "calculate-concentration") runConcentrationCalculation();
    if (action === "export-concentration") exportConcentration();
    if (action === "import-concentration") importConcentration();
    if (action === "copy-concentration") copyConcentration();
    if (action === "print-concentration") printConcentration();
  }

  function runConcentrationCalculation() {
    concentration.errors = {};
    try {
      requireText(concentration.name, "方案名称");
      requireText(concentration.substance, "物质名称");
      if (concentration.mode === "solid") concentration.result = calculateSolidConcentration();
      else if (concentration.mode === "liquid") concentration.result = calculateLiquidConcentration();
      else concentration.result = calculateDilution();
      concentration.stale = false;
      localStorage.setItem(STORAGE.concentration, JSON.stringify(concentrationDraft()));
      renderConcentration();
      setBadge(resultStatus, "计算结果有效", "success");
      toast("已生成可复核的配制方案");
      if (matchMedia("(max-width: 900px)").matches) app.querySelector("#concentration-result-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      const field = error?.field || "计算结果";
      concentration.errors[field] = error?.message || "计算失败，请核对输入";
      concentration.result = null;
      renderConcentration();
      setBadge(resultStatus, "存在输入错误", "danger");
      const target = app.querySelector(`[data-error-field="${CSS.escape(field)}"]`) || app.querySelector('[aria-invalid="true"]');
      target?.focus();
    }
  }

  const concentrationPlanText = () => {
    if (!concentration.result) return "";
    const result = concentration.result;
    return [
      "实验室计算器｜浓度与稀释配制方案",
      `方案名称：${concentration.name}`,
      `计算模式：${CONCENTRATION_MODES[concentration.mode]}`,
      "",
      "输入参数",
      ...concentrationInputSummary(),
      "",
      "计算结果",
      ...result.metrics.map(([label, value]) => `${label}：${value}`),
      "",
      "公式和换算过程",
      ...result.formulas.map((formula, index) => `${index + 1}. ${formula}`),
      "",
      "建议配制步骤",
      ...result.steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "警告与科学性边界",
      ...result.warnings.map((warning) => `- ${warning}`),
      "- 本功能只提供理论计算和操作辅助，不代替实验室SOP、药典、注册标准、试剂标签或经批准的方法。",
      "",
      `计算时间：${new Date(result.calculatedAt).toLocaleString("zh-CN")}`,
    ].join("\n");
  };

  function exportConcentration() {
    const payload = {
      format: "lab-calculator-concentration",
      version: 1,
      savedAt: new Date().toISOString(),
      data: concentrationDraft(),
    };
    const safeName = (concentration.name.trim() || "浓度配制方案").replace(/[\\/:*?"<>|]/g, "_");
    download(`${safeName}.labconcentration.json`, JSON.stringify(payload, null, 2));
    toast("已下载浓度配制方案文件");
  }

  function importConcentration() {
    openFile(async (text, filename) => {
      const payload = JSON.parse(text);
      if (payload?.format !== "lab-calculator-concentration") throw new Error("方案文件 format 不正确");
      if (payload?.version !== 1) throw new Error("仅支持 version 为 1 的浓度配制方案");
      const data = payload?.data;
      if (!data || !CONCENTRATION_MODES[data.mode]) throw new Error("方案文件缺少有效的计算模式");
      const requiredKeys = data.mode === "dilution"
        ? ["name", "substance", "stockConcentration", "targetConcentration", "stockUnit", "targetUnit", "targetVolume", "volumeUnit"]
        : ["name", "substance", "targetConcentration", "targetUnit", "targetVolume", "volumeUnit", "purity"];
      if (requiredKeys.some((key) => !Object.hasOwn(data, key))) throw new Error("方案文件缺少关键输入字段");
      const accepted = await confirmAction({
        title: "导入浓度配制方案？",
        body: `<p>文件：<strong>${e(filename)}</strong></p><p>导入后会替换当前草稿，文件内任何已有计算结果都不会被信任，必须重新计算。</p>`,
        confirmText: "导入并替换",
      });
      if (!accepted) return;
      concentration = { ...defaultConcentration(), ...data, result: null, errors: {}, stale: true };
      localStorage.setItem(STORAGE.concentration, JSON.stringify(concentrationDraft()));
      renderConcentration();
      toast("方案已导入，请重新计算");
    });
  }

  function copyConcentration() {
    if (!concentration.result) {
      toast("输入已修改，请重新计算后再复制", { kind: "warning" });
      return;
    }
    navigator.clipboard.writeText(concentrationPlanText()).then(() => toast("已复制完整配制方案"));
  }

  function printConcentration() {
    if (!concentration.result) {
      toast("输入已修改，请重新计算后再打印", { kind: "warning" });
      return;
    }
    window.print();
  }

  const defaultMediaState = () => {
    const stored = safeParse(localStorage.getItem(STORAGE.mediaPrefs), {});
    return {
      pharmacopoeia: stored.pharmacopoeia || "",
      category: "全部",
      search: "",
      selectedKey: "",
      volume: 1000,
      unit: "mL",
      preparation: null,
    };
  };

  let mediaState = defaultMediaState();

  async function loadMediaCatalog() {
    if (mediaCatalog || mediaLoadError) return;
    try {
      const response = await fetch("data/media_catalog.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      mediaCatalog = await response.json();
      mediaState.pharmacopoeia ||= mediaCatalog.pharmacopoeias[0];
    } catch (error) {
      mediaLoadError = `介质目录加载失败：${error.message}`;
    }
  }

  const mediaItems = () => mediaCatalog?.records.filter((item) => item.pharmacopoeia === mediaState.pharmacopoeia) || [];

  const mediaCategories = () => ["全部", ...new Set(mediaItems().map((item) => item.category))];

  const filteredMedia = () => {
    const query = mediaState.search.trim().toLowerCase();
    return mediaItems().filter((item) => {
      const categoryMatch = mediaState.category === "全部" || item.category === mediaState.category;
      const text = `${item.name} ${item.target_ph || ""} ${item.category} ${item.data_status}`.toLowerCase();
      return categoryMatch && (!query || text.includes(query));
    });
  };

  const mediumKey = (item) => `${item.pharmacopoeia}|||${item.name}`;
  const selectedMedium = () => mediaCatalog?.records.find((item) => mediumKey(item) === mediaState.selectedKey) || null;

  const statusKind = (status) => {
    if (status.includes("已核对")) return "success";
    if (status.includes("公开")) return "info";
    if (status.includes("机器") || status.includes("复核")) return "warning";
    return "neutral";
  };

  const formatMediumStep = (step, medium, targetMl, scaled) => {
    const amountMap = new Map(scaled.map((item) => [item.name, item]));
    let output = step
      .replaceAll("{target_volume_ml}", numberText(targetMl))
      .replaceAll("{initial_water_ml}", numberText(targetMl * 0.7));
    output = output.replace(/\{stock_volume:([^}]+)\}/g, (_, fraction) => numberText(targetMl * Number(fraction)));
    output = output.replace(/\{amount:([^}]+)\}/g, (_, name) => {
      const amount = amountMap.get(name)?.amount;
      return amount == null ? "适量" : numberText(amount);
    });
    output = output.replace(/\{unit:([^}]+)\}/g, (_, name) => amountMap.get(name)?.unit || "");
    return output;
  };

  const prepareMedium = (medium) => {
    const input = Number(mediaState.volume);
    const targetMl = mediaState.unit === "L" ? input * 1000 : input;
    if (!Number.isFinite(targetMl) || targetMl <= 0) throw new Error("目标体积必须是大于 0 的有限数字");
    if (targetMl > 10_000_000) throw new Error("单次目标体积不得超过 10,000 L");
    const scale = targetMl / medium.reference_volume_ml;
    const ingredients = medium.ingredients.map((item) => ({ ...item, amount: item.amount == null ? null : item.amount * scale }));
    const steps = medium.steps.map((step) => formatMediumStep(step, medium, targetMl, ingredients));
    return { medium, targetMl, scale, ingredients, steps, generatedAt: new Date().toISOString() };
  };

  const mediaListHtml = () => {
    const items = filteredMedia();
    if (!items.length) return `<div class="empty-state"><div><strong>没有匹配结果</strong>尝试清除搜索或重置介质类别。</div></div>`;
    return items
      .map(
        (item) => `
          <button class="media-option" type="button" role="option" aria-selected="${mediumKey(item) === mediaState.selectedKey}" data-medium-key="${e(mediumKey(item))}">
            <strong>${e(item.name)}</strong>
            <small><span>${e(item.category)}</span><span class="tag ${statusKind(item.data_status)}">${e(item.data_status)}</span>${item.target_ph ? `<span>pH ${e(item.target_ph)}</span>` : ""}</small>
          </button>
        `,
      )
      .join("");
  };

  const preparationHtml = () => {
    const prep = mediaState.preparation;
    if (!prep) return `<div class="empty-state"><div><strong>尚未生成配制方案</strong>按顺序选择药典、类别与介质，再设置目标体积。</div></div>`;
    const medium = prep.medium;
    const warning = statusKind(medium.data_status) === "warning";
    return `
      ${warning ? `<div class="alert warning"><strong>${e(medium.data_status)}</strong><p>该处方由机器解析，执行前必须逐条核对现行原文、品种各论与批准注册标准；导出和打印会保留此警告。</p></div>` : `<div class="alert success"><strong>${e(medium.data_status)}</strong><p>处方仍须结合具体品种标准、实验室 SOP 与执行批次复核。</p></div>`}
      <div class="tabs mobile-tabs" role="tablist" aria-label="介质结果视图">
        ${["amounts:用量", "sop:SOP", "sources:依据"].map((entry) => {
          const [key, label] = entry.split(":");
          return `<button type="button" role="tab" aria-selected="${ui.mediaTab === key}" data-media-tab="${key}">${label}</button>`;
        }).join("")}
      </div>
      <section class="mobile-tab-panel ${ui.mediaTab === "amounts" ? "active" : ""}" aria-labelledby="amount-title">
        <div class="card-heading"><div><h2 id="amount-title">试剂与用量</h2><p>${e(medium.name)} · 目标 ${numberText(prep.targetMl)} mL</p></div><button class="button secondary" type="button" data-action="copy-amounts">复制用量</button></div>
        <div class="results-table-wrap">
          <table>
            <thead><tr><th scope="col">试剂</th><th scope="col">用量</th><th scope="col">用途</th></tr></thead>
            <tbody>${prep.ingredients.map((item) => `<tr><td>${e(item.name)}</td><td class="tabular">${item.amount == null ? "适量" : numberText(item.amount)} ${e(item.unit)}</td><td>${e(item.purpose)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
      <section class="sop-sections mobile-tab-panel ${ui.mediaTab === "sop" ? "active" : ""}" style="margin-top:16px" aria-label="配置方法与步骤">
        <div class="sop-section">
          <div class="card-heading"><div><h3>操作步骤</h3></div><button class="button secondary" type="button" data-action="copy-sop">复制 SOP</button></div>
          <ol>${prep.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>
        </div>
        ${medium.target_ph ? `<div class="sop-section"><h3>pH 与定容</h3><p>目标 pH：<strong>${e(medium.target_ph)}</strong>。配制后按所选标准在规定温度下实测并记录；加水定容不等于直接加入相同体积的水。</p></div>` : ""}
        <div class="sop-section"><h3>执行前核对</h3><ul>${medium.notes.map((note) => `<li>${e(note)}</li>`).join("")}</ul></div>
      </section>
      <section class="sop-section mobile-tab-panel ${ui.mediaTab === "sources" ? "active" : ""}" style="margin-top:16px" aria-labelledby="source-title">
        <h3 id="source-title">依据与来源</h3>
        <p>${e(medium.compendial_reference)}</p>
        <p><a href="${e(medium.source_url)}" target="_blank" rel="noreferrer">${e(medium.source_title)}</a></p>
        <span class="tag ${statusKind(medium.data_status)}">${e(medium.data_status)}</span>
      </section>
    `;
  };

  function updateMediaList() {
    const host = app.querySelector("#media-results");
    const count = app.querySelector("#media-count");
    if (host) host.innerHTML = mediaListHtml();
    if (count) count.textContent = `${filteredMedia().length} 个候选`;
  }

  function renderDissolution() {
    localStorage.setItem(STORAGE.recent, "dissolution");
    const selected = selectedMedium();
    setShell({
      title: "溶出介质配制辅助",
      save: "筛选偏好已保存",
      saveKind: "success",
      result: mediaState.preparation ? "配制方案已生成" : "待生成",
      resultKind: mediaState.preparation ? (statusKind(mediaState.preparation.medium.data_status) === "warning" ? "warning" : "success") : "neutral",
      context: selected?.name || "",
      menu: [
        { label: "清除筛选", action: resetMediaFilters },
        { label: "复制当前 SOP", action: copyMediaSop },
        { label: "打印 / 导出 PDF", action: () => window.print() },
      ],
    });
    if (mediaLoadError) {
      app.innerHTML = `<div class="page"><div class="alert danger">${e(mediaLoadError)}。请通过 web_server.py 启动，不要直接双击 HTML 文件。</div></div>`;
      setMobileAction();
      return;
    }
    const pharmOptions = mediaCatalog?.pharmacopoeias || [];
    app.innerHTML = `
      <div class="page tool-page">
        <div class="page-heading">
          <div>
            <p class="eyebrow">DISSOLUTION MEDIA</p>
            <h1>溶出介质配制辅助</h1>
            <p>按“药典版本 → 介质类别 → 搜索与选择 → 目标体积”的顺序生成结果。</p>
          </div>
          <div class="button-row"><button class="button secondary" type="button" data-action="print-media" ${mediaState.preparation ? "" : "disabled"}>打印 / 导出 PDF</button></div>
        </div>
        <section class="card" aria-labelledby="media-selector-title">
          <div class="card-heading">
            <div><h2 id="media-selector-title">1. 选择介质</h2><p>改变筛选条件只刷新候选列表，不会悄悄覆盖已生成的方案。</p></div>
            <span class="tag neutral" id="media-count">${filteredMedia().length} 个候选</span>
          </div>
          <div class="selector-grid">
            <div class="field wide">
              <label for="pharmacopoeia">药典版本</label>
              <select id="pharmacopoeia" data-media-field="pharmacopoeia">${pharmOptions.map((item) => `<option ${item === mediaState.pharmacopoeia ? "selected" : ""}>${e(item)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label for="media-category">介质类别</label>
              <select id="media-category" data-media-field="category">${mediaCategories().map((item) => `<option ${item === mediaState.category ? "selected" : ""}>${e(item)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label for="media-search">搜索名称 / pH</label>
              <input id="media-search" type="search" value="${e(mediaState.search)}" data-media-field="search" placeholder="例如：磷酸盐 pH 6.8">
            </div>
          </div>
          <div class="media-results" id="media-results" role="listbox" aria-label="可用介质候选" style="margin-top:16px">${mediaListHtml()}</div>
        </section>
        <section class="card" aria-labelledby="generate-title">
          <div class="card-heading"><div><h2 id="generate-title">2. 设置体积并生成</h2><p>${selected ? `已选择：${e(selected.name)}` : "请先从候选列表选择一个介质。"}</p></div>${selected ? `<span class="tag ${statusKind(selected.data_status)}">${e(selected.data_status)}</span>` : ""}</div>
          <div class="summary-grid">
            <div class="field" style="grid-column:span 2">
              <label for="selected-medium">目标介质</label>
              <input id="selected-medium" value="${selected ? e(selected.name) : ""}" readonly aria-describedby="selected-medium-help">
              <span class="field-help" id="selected-medium-help">${selected ? e(selected.compential_reference || selected.compendial_reference) : "从上方候选列表中选择。"}</span>
            </div>
            <div class="field">
              <label for="media-volume">目标体积</label>
              <div class="input-group">
                <input id="media-volume" type="number" min="0" step="any" inputmode="decimal" value="${e(mediaState.volume)}" data-media-field="volume">
                <select data-media-field="unit" aria-label="目标体积单位"><option ${mediaState.unit === "mL" ? "selected" : ""}>mL</option><option ${mediaState.unit === "L" ? "selected" : ""}>L</option></select>
              </div>
            </div>
            <div class="primary-action desktop-only"><button class="button primary" type="button" data-action="generate-media" ${selected ? "" : "disabled"}>生成配制方案</button></div>
          </div>
        </section>
        <section class="card" id="media-preparation" aria-label="生成结果">${preparationHtml()}</section>
      </div>
    `;
    setMobileAction(
      `<button class="button secondary" type="button" data-mobile-action="reset">重置筛选</button><button class="button primary" type="button" data-mobile-action="generate" ${selected ? "" : "disabled"}>生成配制方案</button>`,
      (event) => {
        const action = event.target.closest("[data-mobile-action]")?.dataset.mobileAction;
        if (action === "generate") runMediaPreparation();
        if (action === "reset") resetMediaFilters();
      },
    );
    app.onclick = handleMediaClick;
    app.oninput = handleMediaInput;
    app.onchange = handleMediaChange;
  }

  function handleMediaClick(event) {
    const option = event.target.closest("[data-medium-key]");
    if (option) {
      mediaState.selectedKey = option.dataset.mediumKey;
      mediaState.preparation = null;
      renderDissolution();
      return;
    }
    const tab = event.target.closest("[data-media-tab]");
    if (tab) {
      ui.mediaTab = tab.dataset.mediaTab;
      renderDissolution();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "generate-media") runMediaPreparation();
    if (action === "copy-amounts") copyMediaAmounts();
    if (action === "copy-sop") copyMediaSop();
    if (action === "print-media") window.print();
  }

  function handleMediaInput(event) {
    if (event.target.dataset.mediaField === "search") {
      mediaState.search = event.target.value;
      updateMediaList();
    }
    if (event.target.dataset.mediaField === "volume") mediaState.volume = event.target.value;
  }

  function handleMediaChange(event) {
    const field = event.target.dataset.mediaField;
    if (!field) return;
    if (field === "pharmacopoeia") {
      mediaState.pharmacopoeia = event.target.value;
      mediaState.category = "全部";
      mediaState.selectedKey = "";
      mediaState.preparation = null;
      localStorage.setItem(STORAGE.mediaPrefs, JSON.stringify({ pharmacopoeia: mediaState.pharmacopoeia }));
      renderDissolution();
    } else if (field === "category") {
      mediaState.category = event.target.value;
      mediaState.selectedKey = "";
      mediaState.preparation = null;
      renderDissolution();
    } else if (field === "unit") {
      mediaState.unit = event.target.value;
    }
  }

  function resetMediaFilters() {
    mediaState.category = "全部";
    mediaState.search = "";
    mediaState.selectedKey = "";
    mediaState.preparation = null;
    renderDissolution();
  }

  function runMediaPreparation() {
    try {
      const medium = selectedMedium();
      if (!medium) throw new Error("请先选择一个溶出介质体系");
      mediaState.preparation = prepareMedium(medium);
      ui.mediaTab = "amounts";
      renderDissolution();
      toast(`已生成“${medium.name}”的试剂用量与 SOP`);
    } catch (error) {
      setBadge(resultStatus, "生成失败", "danger");
      toast(error.message, { kind: "error" });
    }
  }

  function mediaAmountText() {
    const prep = mediaState.preparation;
    if (!prep) return "";
    return prep.ingredients.map((item) => `${item.name}：${item.amount == null ? "适量" : numberText(item.amount)} ${item.unit}`).join("\n");
  }

  function copyMediaAmounts() {
    const text = mediaAmountText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => toast(`已复制 ${mediaState.preparation.ingredients.length} 项试剂用量`));
  }

  function copyMediaSop() {
    const prep = mediaState.preparation;
    if (!prep) {
      toast("请先生成配制方案", { kind: "warning" });
      return;
    }
    const text = [
      `${prep.medium.name} · ${numberText(prep.targetMl)} mL`,
      prep.medium.data_status,
      "",
      "试剂与用量",
      mediaAmountText(),
      "",
      "操作步骤",
      ...prep.steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "执行前核对",
      ...prep.medium.notes.map((note) => `- ${note}`),
      "",
      `依据：${prep.medium.compendial_reference}`,
      `来源：${prep.medium.source_url}`,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => toast("已复制完整 SOP、风险状态与来源"));
  }

  const defaultHplc = () => ({
    version: 2,
    step: 1,
    phaseCount: 2,
    phases: [
      { code: "A", name: "水或缓冲盐溶液", note: "" },
      { code: "B", name: "乙腈", note: "" },
      { code: "C", name: "甲醇", note: "" },
      { code: "D", name: "其他溶剂", note: "" },
    ],
    flowRate: 1,
    deadTime: 0,
    autoComplete: true,
    points: [
      { id: uid(), time: 0, values: [90, 10, 0, 0] },
      { id: uid(), time: 5, values: [50, 50, 0, 0] },
      { id: uid(), time: 10, values: [10, 90, 0, 0] },
    ],
    confirmed: null,
    chartAccepted: false,
    stale: false,
    targets: [
      { id: uid(), name: "目标物 1", wavelength: 254, retention: 4.2, error: "" },
    ],
    results: [],
    selectedResultIds: [],
    optimization: null,
  });

  let hplc = safeParse(localStorage.getItem(STORAGE.hplc), defaultHplc());
  hplc.step ||= 1;
  hplc.phases ||= defaultHplc().phases;
  hplc.points ||= defaultHplc().points;
  hplc.targets ||= [];
  hplc.results ||= [];
  hplc.selectedResultIds ||= [];
  hplc.optimization ||= null;

  const hplcSteps = [
    ["基本参数", "流动相与时间"],
    ["梯度程序", "时间点与比例"],
    ["梯度图确认", "图表与版本"],
    ["目标物与汇总", "批量计算"],
    ["优化与导出", "实验建议"],
  ];

  const hplcSavePayload = () => ({ ...hplc, results: [], selectedResultIds: [], optimization: null });

  function saveHplcDraft() {
    scheduleSave("hplc", hplcSavePayload());
  }

  function markHplcUpstreamDirty() {
    if (hplc.confirmed) {
      hplc.stale = true;
      hplc.chartAccepted = false;
      setBadge(resultStatus, "上游已修改 · 结果过期", "warning");
    }
    hplc.optimization = null;
    saveHplcDraft();
  }

  const validateHplcProgram = () => {
    const phaseCount = Number(hplc.phaseCount);
    if (!Number.isInteger(phaseCount) || phaseCount < 1 || phaseCount > 4) throw new Error("流动相元数必须为 1 至 4");
    hplc.phases.slice(0, phaseCount).forEach((phase) => {
      if (!phase.name.trim()) throw new Error(`${phase.code} 相名称不能为空`);
    });
    const flow = Number(hplc.flowRate);
    const dead = Number(hplc.deadTime);
    if (!Number.isFinite(flow) || flow <= 0) throw new Error("流速必须大于 0");
    if (!Number.isFinite(dead) || dead < 0) throw new Error("柱死时间必须大于或等于 0");
    if (hplc.points.length < 2) throw new Error("梯度程序至少需要两个时间点");
    let previous = -Infinity;
    hplc.points.forEach((point, index) => {
      const time = Number(point.time);
      if (!Number.isFinite(time) || time < 0) throw new Error(`第 ${index + 1} 个时间点必须大于或等于 0`);
      if (time <= previous) throw new Error(`第 ${index + 1} 个时间点必须严格大于上一个时间点`);
      const values = point.values.slice(0, phaseCount).map(Number);
      if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`第 ${index + 1} 个时间点的比例必须在 0% 至 100% 之间`);
      const sum = values.reduce((total, value) => total + value, 0);
      if (Math.abs(sum - 100) > 0.01) throw new Error(`第 ${index + 1} 个时间点合计为 ${numberText(sum)}%，必须等于 100%`);
      previous = time;
    });
    return true;
  };

  const interpolate = (time, points = hplc.points) => {
    const query = Number(time);
    const first = points[0];
    const last = points.at(-1);
    if (query < Number(first.time) || query > Number(last.time)) throw new Error("出峰时间不在当前梯度程序范围内");
    const exact = points.find((point) => Number(point.time) === query);
    if (exact) return exact.values.slice(0, hplc.phaseCount).map(Number);
    for (let index = 0; index < points.length - 1; index += 1) {
      const left = points[index];
      const right = points[index + 1];
      if (Number(left.time) <= query && query <= Number(right.time)) {
        const fraction = (query - Number(left.time)) / (Number(right.time) - Number(left.time));
        return left.values.slice(0, hplc.phaseCount).map((value, phaseIndex) => Number(value) + fraction * (Number(right.values[phaseIndex]) - Number(value)));
      }
    }
    throw new Error("无法在梯度程序中定位出峰时间");
  };

  const calculateTarget = (target) => {
    if (!target.name.trim()) throw new Error("目标物名称不能为空");
    const wavelength = Number(target.wavelength);
    const retention = Number(target.retention);
    if (!Number.isFinite(wavelength) || wavelength <= 0) throw new Error("检测波长必须大于 0");
    if (!Number.isFinite(retention) || retention < 0) throw new Error("出峰时间必须大于或等于 0");
    const pump = interpolate(retention);
    const columnTime = retention - Number(hplc.deadTime);
    let column;
    let note = "";
    if (Number(hplc.deadTime) === 0) {
      column = pump;
      note = "未进行柱死时间校正";
    } else if (columnTime < Number(hplc.points[0].time)) {
      column = hplc.points[0].values.slice(0, hplc.phaseCount).map(Number);
      note = "校正时间早于梯度起点，按初始比例估算";
    } else {
      column = interpolate(columnTime);
    }
    return { id: target.id, name: target.name, wavelength, retention, pumpTime: retention, columnTime, pump, column, note };
  };

  const compositionText = (values) =>
    values.map((value, index) => `${PHASE_CODES[index]} ${numberText(value, 2)}%`).join(" · ");

  const hplcStepState = (step) => {
    if (hplc.stale && step >= 2) return "stale";
    if (step === 1 && hplc.phaseCount) return "complete";
    if (step === 2 && hplc.confirmed && !hplc.stale) return "complete";
    if (step === 3 && hplc.chartAccepted && !hplc.stale) return "complete";
    if (step === 4 && hplc.results.length && !hplc.stale) return "complete";
    if (step === 5 && hplc.optimization && !hplc.stale) return "complete";
    return "";
  };

  const stepperHtml = () => `
    <nav class="stepper" aria-label="HPLC 五步流程">
      ${hplcSteps
        .map(
          ([label, note], index) => `
            <button class="step-button ${hplcStepState(index + 1)}" type="button" data-hplc-step="${index + 1}" ${hplc.step === index + 1 ? 'aria-current="step"' : ""}>
              <span class="step-number">${hplcStepState(index + 1) === "complete" ? "✓" : index + 1}</span>
              <span class="step-label"><strong>${label}</strong><small>${hplcStepState(index + 1) === "stale" ? "待重新确认" : note}</small></span>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;

  const stepOneHtml = () => `
    <div class="step-title"><p class="eyebrow">STEP 1 OF 5</p><h1>基本参数</h1><p>先确定启用的流动相、流速与柱死时间；未启用的相不会参与输入或计算。</p></div>
    <section class="card">
      <div class="card-heading"><div><h2>流动相设置</h2><p>改变元数可能清除未启用相的数据。</p></div><div class="segmented" aria-label="流动相元数">${[1, 2, 3, 4].map((count) => `<button type="button" aria-pressed="${hplc.phaseCount === count}" data-phase-count="${count}">${count}</button>`).join("")}</div></div>
      <div class="two-column-fields">
        <div class="field"><label for="flow-rate">流速 <span class="required">*</span></label><div class="input-group"><input id="flow-rate" type="number" min="0" step="any" inputmode="decimal" value="${e(hplc.flowRate)}" data-hplc-field="flowRate"><span class="input-suffix">mL/min</span></div></div>
        <div class="field"><label for="dead-time">柱死时间</label><div class="input-group"><input id="dead-time" type="number" min="0" step="any" inputmode="decimal" value="${e(hplc.deadTime)}" data-hplc-field="deadTime"><span class="input-suffix">min</span></div><span class="field-help">填 0 表示暂不校正，并非真实测量值。</span></div>
      </div>
      <div class="phase-grid">
        ${hplc.phases
          .slice(0, hplc.phaseCount)
          .map(
            (phase, index) => `
              <div class="phase-card">
                <span class="phase-code">${phase.code}</span>
                <div class="field"><label for="phase-name-${index}">${phase.code} 相名称 <span class="required">*</span></label><input id="phase-name-${index}" value="${e(phase.name)}" data-phase-field="name" data-phase-index="${index}"></div>
                <div class="field" style="margin-top:10px"><label for="phase-note-${index}">简短说明（可选）</label><input id="phase-note-${index}" value="${e(phase.note)}" data-phase-field="note" data-phase-index="${index}"></div>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="button-row desktop-only" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="hplc-step1-next">保存并继续</button></div>
    </section>
  `;

  const gradientRowsHtml = () => {
    const labels = [`时间 (min)`, ...PHASE_CODES.slice(0, hplc.phaseCount).map((code) => `${code} 相 (%)`), "合计", "操作"];
    return `
      <div class="gradient-row header-row" style="--phase-count:${hplc.phaseCount}">${labels.map((label) => `<span>${label}</span>`).join("")}</div>
      ${hplc.points
        .map((point, rowIndex) => {
          const sum = point.values.slice(0, hplc.phaseCount).reduce((total, value) => total + Number(value || 0), 0);
          return `
            <div class="gradient-row" style="--phase-count:${hplc.phaseCount}" data-gradient-row="${rowIndex}">
              <div data-label="时间 (min)"><label class="visually-hidden" for="point-time-${rowIndex}">第 ${rowIndex + 1} 行时间</label><input id="point-time-${rowIndex}" type="number" min="0" step="any" inputmode="decimal" value="${e(point.time)}" data-point-field="time" data-row-index="${rowIndex}"></div>
              ${point.values
                .slice(0, hplc.phaseCount)
                .map(
                  (value, phaseIndex) => `
                    <div data-label="${PHASE_CODES[phaseIndex]} 相 (%)"><label class="visually-hidden" for="point-${rowIndex}-${phaseIndex}">第 ${rowIndex + 1} 行 ${PHASE_CODES[phaseIndex]} 相比例</label><input id="point-${rowIndex}-${phaseIndex}" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(value)}" data-point-field="value" data-row-index="${rowIndex}" data-phase-index="${phaseIndex}" ${hplc.autoComplete && phaseIndex === hplc.phaseCount - 1 ? "readonly" : ""}></div>
                  `,
                )
                .join("")}
              <span class="sum-chip ${Math.abs(sum - 100) > 0.01 ? "invalid" : ""}" data-label="比例合计" data-sum-row="${rowIndex}">${numberText(sum, 3)}%</span>
              <button class="mini-button" type="button" data-action="delete-gradient-row" data-row-index="${rowIndex}" aria-label="删除第 ${rowIndex + 1} 个时间点">×</button>
            </div>
          `;
        })
        .join("")}
    `;
  };

  const stepTwoHtml = () => `
    <div class="step-title"><p class="eyebrow">STEP 2 OF 5</p><h1>梯度程序</h1><p>时间必须严格递增，每个时间点启用相的比例合计必须为 100%。</p></div>
    ${hplc.stale ? `<div class="alert warning"><strong>当前确认版本已失效。</strong><p>基本参数或梯度被修改，请重新检查并确认。</p></div>` : ""}
    <section class="card">
      <div class="card-heading">
        <div><h2>时间点与流动相比例</h2><p>手机端每个时间点独立成卡，桌面端按行编辑。</p></div>
        <label class="button secondary"><input type="checkbox" style="width:18px;min-height:18px" data-hplc-field="autoComplete" ${hplc.autoComplete ? "checked" : ""}> 自动补足 ${PHASE_CODES[hplc.phaseCount - 1]} 相</label>
      </div>
      <div class="gradient-list" id="gradient-list">${gradientRowsHtml()}</div>
      <div class="button-row" style="margin-top:14px"><button class="button secondary" type="button" data-action="add-gradient-row">＋ 增加时间点</button></div>
      <div class="button-row desktop-only" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="confirm-gradient">确认梯度并继续</button></div>
    </section>
  `;

  const chartTableHtml = (points = hplc.points) => `
    <div class="results-table-wrap" style="margin-top:16px">
      <table>
        <caption class="visually-hidden">梯度图等价数据表</caption>
        <thead><tr><th scope="col">时间 (min)</th>${PHASE_CODES.slice(0, hplc.phaseCount).map((code) => `<th scope="col">${code} 相 (%)</th>`).join("")}</tr></thead>
        <tbody>${points.map((point) => `<tr><td class="tabular">${numberText(point.time)}</td>${point.values.slice(0, hplc.phaseCount).map((value) => `<td class="tabular">${numberText(value, 3)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;

  const chartHtml = (points = hplc.points, id = "gradient-chart", windows = []) => `
    <div class="chart-shell">
      <canvas class="gradient-chart" id="${id}" role="img" aria-label="各流动相比例随时间变化的梯度折线图${windows.length ? `，标注了 ${windows.length} 个目标物的潜在洗脱窗口` : ""}"></canvas>
      <p class="field-help" id="${id}-readout" aria-live="polite">移动指针或触摸图表可查看最近时间点${windows.length ? "及对应洗脱窗口" : ""}；下方数据表提供等价信息。</p>
    </div>
    <div class="chart-legend" aria-label="图表系列">
      ${hplc.phases
        .slice(0, hplc.phaseCount)
        .map((phase, index) => `<button class="legend-button" type="button" aria-pressed="${!ui.hiddenPhases.has(index)}" data-chart-phase="${index}" style="color:${CHART_COLORS[index]}"><span class="legend-swatch"></span><span>${phase.code} · ${e(phase.name)}</span></button>`)
        .join("")}
    </div>
    ${
      windows.length
        ? `<div class="window-legend" aria-label="目标物潜在洗脱窗口">${windows
            .map(
              (window, index) => `
                <span class="window-key">
                  <span class="window-key-swatch" style="--window-color:${WINDOW_COLORS[index % WINDOW_COLORS.length]}"></span>
                  <strong>${e(window.target)}</strong>
                  <span>${numberText(window.start, 3)}–${numberText(window.end, 3)} min</span>
                </span>
              `,
            )
            .join("")}</div>`
        : ""
    }
    ${chartTableHtml(points)}
  `;

  const stepThreeHtml = () => `
    <div class="step-title"><p class="eyebrow">STEP 3 OF 5</p><h1>梯度图确认</h1><p>图表、程序摘要和确认版本共同用于复核当前输入快照。</p></div>
    ${!hplc.confirmed || hplc.stale ? `<div class="alert warning"><strong>需要重新确认梯度。</strong><p>返回步骤 2 检查时间与比例后，创建新的确认版本。</p></div>` : `<div class="alert success"><strong>已确认版本 ${e(hplc.confirmed.version)}</strong><p>确认时间：${e(new Date(hplc.confirmed.time).toLocaleString("zh-CN"))}。后续计算将基于此输入快照。</p></div>`}
    <section class="card">
      <div class="card-heading"><div><h2>梯度曲线</h2><p>${hplc.points.length} 个时间点 · ${hplc.phaseCount} 元流动相 · 线性插值</p></div></div>
      ${hplc.confirmed && !hplc.stale ? chartHtml() : `<div class="empty-state"><div><strong>尚无有效梯度图</strong><button class="button secondary" type="button" data-hplc-step="2">返回检查梯度</button></div></div>`}
      ${hplc.confirmed && !hplc.stale ? `<div class="button-row desktop-only" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="accept-gradient-chart">使用此梯度计算</button></div>` : ""}
    </section>
  `;

  const analyteCardsHtml = () =>
    hplc.targets
      .map((target, index) => {
        const result = hplc.results.find((item) => item.id === target.id);
        return `
          <div class="analyte-card" data-target-card="${target.id}">
            <div class="analyte-inputs">
              <div class="field"><label for="target-name-${index}">目标物 ${index + 1} 名称</label><input id="target-name-${index}" value="${e(target.name)}" data-target-field="name" data-target-index="${index}"></div>
              <div class="field"><label for="target-wave-${index}">检测波长</label><div class="input-group"><input id="target-wave-${index}" type="number" min="0" step="any" inputmode="decimal" value="${e(target.wavelength)}" data-target-field="wavelength" data-target-index="${index}"><span class="input-suffix">nm</span></div></div>
              <div class="field"><label for="target-time-${index}">出峰时间</label><div class="input-group"><input id="target-time-${index}" type="number" min="0" step="any" inputmode="decimal" value="${e(target.retention)}" data-target-field="retention" data-target-index="${index}"><span class="input-suffix">min</span></div></div>
              <button class="button danger-button" type="button" data-action="delete-target" data-target-index="${index}" aria-label="删除${e(target.name)}">删除</button>
            </div>
            ${target.error ? `<span class="field-error">错误：${e(target.error)}</span>` : ""}
            ${result ? `<div class="analyte-result"><div class="metric"><small>泵端比例</small><strong>${compositionText(result.pump)}</strong></div><div class="metric"><small>柱出口比例</small><strong>${compositionText(result.column)}</strong></div><div class="metric"><small>校正时间</small><strong>${numberText(result.columnTime, 3)} min${result.note ? ` · ${e(result.note)}` : ""}</strong></div></div>` : ""}
          </div>
        `;
      })
      .join("");

  const summaryCardsHtml = () => {
    if (!hplc.results.length) return `<div class="empty-state"><div><strong>尚无成功结果</strong>填写目标物后选择“计算全部目标物”。</div></div>`;
    return hplc.results
      .map(
        (result) => `
          <div class="summary-card">
            <input id="select-result-${result.id}" type="checkbox" data-result-select="${result.id}" ${hplc.selectedResultIds.includes(result.id) ? "checked" : ""}>
            <label for="select-result-${result.id}"><strong>${e(result.name)}</strong><small style="display:block;color:var(--muted)">${numberText(result.wavelength)} nm · ${numberText(result.retention)} min</small></label>
            <span class="tag success">${compositionText(result.pump)}</span>
          </div>
        `,
      )
      .join("");
  };

  const stepFourHtml = () => `
    <div class="step-title"><p class="eyebrow">STEP 4 OF 5</p><h1>目标物与洗脱窗口汇总</h1><p>输入和结果分开呈现；批量计算允许部分成功，并逐项列明失败原因。</p></div>
    ${hplc.stale ? `<div class="alert warning"><strong>当前结果已过期。</strong><p>请返回梯度步骤重新确认后再计算。</p></div>` : ""}
    <section class="card">
      <div class="card-heading"><div><h2>目标物输入</h2><p>“计算全部”是本步骤唯一主动作。</p></div><button class="button secondary" type="button" data-action="add-target">＋ 增加目标物</button></div>
      <div class="analyte-list">${analyteCardsHtml()}</div>
      <div class="button-row desktop-only" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="calculate-all-targets" ${!hplc.chartAccepted || hplc.stale ? "disabled" : ""}>计算全部目标物</button></div>
    </section>
    <section class="card">
      <div class="card-heading"><div><h2>洗脱窗口汇总</h2><p id="selected-summary-count">已选择 ${hplc.selectedResultIds.length} 个目标物用于下一步初步优化。</p></div></div>
      <div class="analyte-list" id="hplc-summary-list">${summaryCardsHtml()}</div>
      <div class="alert warning" style="margin-top:16px">流动相比例差异不能替代实际色谱分离度；所有结果均需通过标准品与实际系统验证。</div>
      <div class="button-row" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="go-optimization" ${hplc.results.length ? "" : "disabled"}>生成洗脱窗口汇总</button></div>
    </section>
  `;

  const optimizeGradient = () => {
    const selected = hplc.results.filter((result) => hplc.selectedResultIds.includes(result.id));
    if (!selected.length) throw new Error("请至少选择一个已成功计算的目标物");
    const half = 15 / 60;
    const start = Number(hplc.points[0].time);
    const end = Number(hplc.points.at(-1).time);
    const windows = selected
      .map((result) => ({
        target: result.name,
        center: result.pumpTime,
        start: Math.max(start, result.pumpTime - half),
        end: Math.min(end, result.pumpTime + half),
        values: result.pump,
      }))
      .sort((a, b) => a.center - b.center);
    windows.forEach((window, index) => {
      window.overlaps = windows.some((other, otherIndex) => index !== otherIndex && window.start <= other.end && other.start <= window.end);
    });
    const clusters = [];
    windows.forEach((window) => {
      const last = clusters.at(-1);
      if (!last || window.start > Math.max(...last.map((item) => item.end))) clusters.push([window]);
      else last.push(window);
    });
    const ranges = clusters.map((cluster) => [Math.min(...cluster.map((item) => item.start)), Math.max(...cluster.map((item) => item.end))]);
    const points = new Map();
    hplc.points.forEach((point) => {
      if (!ranges.some(([left, right]) => left <= Number(point.time) && Number(point.time) <= right)) points.set(Number(point.time), point.values.map(Number));
    });
    clusters.forEach((cluster) => {
      const clusterStart = Math.min(...cluster.map((item) => item.start));
      const clusterEnd = Math.max(...cluster.map((item) => item.end));
      points.set(clusterStart, [...cluster[0].values, ...Array(4).fill(0)].slice(0, 4));
      cluster.forEach((window) => points.set(window.center, [...window.values, ...Array(4).fill(0)].slice(0, 4)));
      points.set(clusterEnd, [...cluster.at(-1).values, ...Array(4).fill(0)].slice(0, 4));
    });
    const optimizedPoints = [...points.entries()].sort((a, b) => a[0] - b[0]).map(([time, values]) => ({ id: uid(), time, values }));
    return {
      windows,
      points: optimizedPoints,
      warnings: windows.some((window) => window.overlaps) ? ["存在重叠洗脱窗口，已合并为连续缓梯度区，并保留各目标物中心配比锚点。"] : [],
      generatedAt: new Date().toISOString(),
    };
  };

  const stepFiveHtml = () => `
    <div class="step-title"><p class="eyebrow">STEP 5 OF 5</p><h1>初步优化与导出</h1><p>选择与建议的因果关系保持可见；建议程序必须通过混合标准品验证。</p></div>
    <div class="alert warning"><strong>这是初步优化建议，不是最佳梯度或保留时间预测。</strong><p>潜在洗脱窗口以目标物泵端比例为锚点，前后各 15 秒建立局部缓梯度区；请结合系统延迟、柱效和实际分离度验证。</p></div>
    <section class="card">
      <div class="card-heading"><div><h2>目标物选择</h2><p id="selected-summary-count">已选择 ${hplc.selectedResultIds.length} 个目标物。可返回上一步修改选择。</p></div><button class="button secondary" type="button" data-hplc-step="4">返回选择</button></div>
      <div class="analyte-list">${summaryCardsHtml()}</div>
      <div class="button-row desktop-only" style="justify-content:flex-end;margin-top:18px"><button class="button primary" type="button" data-action="optimize-gradient" ${hplc.selectedResultIds.length ? "" : "disabled"}>生成初步优化建议</button></div>
    </section>
    <section class="card" id="optimization-result">
      ${
        hplc.optimization
          ? `
            ${hplc.optimization.warnings.map((warning) => `<div class="alert warning">${e(warning)}</div>`).join("")}
            <div class="card-heading"><div><h2>建议梯度程序</h2><p>半透明色带表示潜在洗脱窗口；中心线和标签标出对应目标物、中心时间与 ±15 s。</p></div><span class="tag success">${hplc.optimization.points.length} 个时间点</span></div>
            ${chartHtml(hplc.optimization.points, "optimized-chart", hplc.optimization.windows)}
            <div class="sop-section" style="margin-top:16px"><h3>潜在洗脱窗口</h3><ul>${hplc.optimization.windows.map((window) => `<li><strong>${e(window.target)}</strong>：中心 ${numberText(window.center, 3)} min，范围 ${numberText(window.start, 3)}–${numberText(window.end, 3)} min（±15 s）${window.overlaps ? " · 与其他窗口重叠" : ""}</li>`).join("")}</ul></div>
          `
          : `<div class="empty-state"><div><strong>尚未生成建议</strong>确认目标物选择后，选择“生成初步优化建议”。</div></div>`
      }
    </section>
    <section class="card">
      <div class="card-heading"><div><h2>导出</h2><p>只有当前结果有效时才能导出；文件会携带科学性说明。</p></div></div>
      <div class="export-grid">
        <button class="button secondary" type="button" data-action="export-csv" ${hplc.results.length && !hplc.stale ? "" : "disabled"}>导出 CSV</button>
        <button class="button secondary" type="button" data-action="export-excel" ${hplc.results.length && !hplc.stale ? "" : "disabled"}>导出 Excel</button>
        <button class="button secondary" type="button" data-action="export-png" ${hplc.confirmed && !hplc.stale ? "" : "disabled"}>导出图表 PNG</button>
        <button class="button secondary" type="button" data-action="export-hplc-json">下载方案 JSON</button>
      </div>
    </section>
  `;

  const stepContentHtml = () => {
    if (hplc.step === 1) return stepOneHtml();
    if (hplc.step === 2) return stepTwoHtml();
    if (hplc.step === 3) return stepThreeHtml();
    if (hplc.step === 4) return stepFourHtml();
    return stepFiveHtml();
  };

  function updateHplcStatus() {
    if (hplc.stale) setBadge(resultStatus, "结果过期 · 待重新确认", "warning");
    else if (hplc.confirmed) setBadge(resultStatus, `已确认 ${hplc.confirmed.version}`, "success");
    else setBadge(resultStatus, "梯度未确认", "neutral");
    statusContext.textContent = `步骤 ${hplc.step}/5 · ${hplcSteps[hplc.step - 1][0]}`;
  }

  function renderHplc() {
    localStorage.setItem(STORAGE.recent, "hplc");
    setShell({
      title: "HPLC梯度程序辅助",
      save: `草稿已保存 · ${formatTime()}`,
      saveKind: "success",
      result: hplc.stale ? "结果过期 · 待重新确认" : hplc.confirmed ? `已确认 ${hplc.confirmed.version}` : "梯度未确认",
      resultKind: hplc.stale ? "warning" : hplc.confirmed ? "success" : "neutral",
      context: `步骤 ${hplc.step}/5 · ${hplcSteps[hplc.step - 1][0]}`,
      menu: [
        { label: "新建 HPLC 方案", action: resetHplc },
        { label: "导入方案文件", action: importHplc },
        { label: "下载方案文件", action: exportHplcJson },
      ],
    });
    app.innerHTML = `
      <div class="page tool-page">
        <div class="step-layout">
          ${stepperHtml()}
          <div class="step-content">${stepContentHtml()}</div>
        </div>
      </div>
    `;
    const mobileActions = {
      1: `<button class="button primary" type="button" data-mobile-action="step1">保存并继续</button>`,
      2: `<button class="button secondary" type="button" data-mobile-action="add-point">＋ 时间点</button><button class="button primary" type="button" data-mobile-action="confirm">确认梯度并继续</button>`,
      3: hplc.confirmed && !hplc.stale ? `<button class="button primary" type="button" data-mobile-action="accept-chart">使用此梯度计算</button>` : `<button class="button primary" type="button" data-mobile-action="back-gradient">返回检查梯度</button>`,
      4: `<button class="button secondary" type="button" data-mobile-action="add-target">＋ 目标物</button><button class="button primary" type="button" data-mobile-action="calculate-all" ${!hplc.chartAccepted || hplc.stale ? "disabled" : ""}>计算全部目标物</button>`,
      5: `<button class="button secondary" type="button" data-mobile-action="export-menu">导出</button><button class="button primary" type="button" data-mobile-action="optimize" ${hplc.selectedResultIds.length ? "" : "disabled"}>生成初步优化建议</button>`,
    };
    setMobileAction(mobileActions[hplc.step], handleHplcMobileAction);
    app.onclick = handleHplcClick;
    app.oninput = handleHplcInput;
    app.onchange = handleHplcChange;
    if (hplc.step === 3 && hplc.confirmed && !hplc.stale) requestAnimationFrame(() => setupChart("gradient-chart", hplc.points));
    if (hplc.step === 5 && hplc.optimization) requestAnimationFrame(() => setupChart("optimized-chart", hplc.optimization.points, hplc.optimization.windows));
  }

  function handleHplcMobileAction(event) {
    const action = event.target.closest("[data-mobile-action]")?.dataset.mobileAction;
    if (action === "step1") advanceHplcStepOne();
    if (action === "add-point") addGradientRow();
    if (action === "confirm") confirmGradient();
    if (action === "accept-chart") acceptGradientChart();
    if (action === "back-gradient") goHplcStep(2);
    if (action === "add-target") addTarget();
    if (action === "calculate-all") calculateAllTargets();
    if (action === "optimize") runOptimization();
    if (action === "export-menu") {
      showInformation({ title: "导出结果", body: `<p>页面底部提供 CSV、Excel、图表 PNG 和方案 JSON。当前无有效结果时，对应入口会保持禁用。</p>` });
    }
  }

  function handleHplcClick(event) {
    const step = event.target.closest("[data-hplc-step]")?.dataset.hplcStep;
    if (step) {
      goHplcStep(Number(step));
      return;
    }
    const phaseCount = event.target.closest("[data-phase-count]")?.dataset.phaseCount;
    if (phaseCount) {
      changePhaseCount(Number(phaseCount));
      return;
    }
    const chartPhase = event.target.closest("[data-chart-phase]")?.dataset.chartPhase;
    if (chartPhase != null) {
      const index = Number(chartPhase);
      if (ui.hiddenPhases.has(index)) ui.hiddenPhases.delete(index);
      else ui.hiddenPhases.add(index);
      const canvasId = hplc.step === 5 ? "optimized-chart" : "gradient-chart";
      const points = hplc.step === 5 ? hplc.optimization?.points : hplc.points;
      const windows = hplc.step === 5 ? hplc.optimization?.windows || [] : [];
      drawChart(document.querySelector(`#${canvasId}`), points || hplc.points, windows);
      event.target.closest("[data-chart-phase]").setAttribute("aria-pressed", String(!ui.hiddenPhases.has(index)));
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    const action = actionButton?.dataset.action;
    if (!action) return;
    if (action === "hplc-step1-next") advanceHplcStepOne();
    if (action === "add-gradient-row") addGradientRow();
    if (action === "delete-gradient-row") deleteGradientRow(Number(actionButton.dataset.rowIndex));
    if (action === "confirm-gradient") confirmGradient();
    if (action === "accept-gradient-chart") acceptGradientChart();
    if (action === "add-target") addTarget();
    if (action === "delete-target") deleteTarget(Number(actionButton.dataset.targetIndex));
    if (action === "calculate-all-targets") calculateAllTargets();
    if (action === "go-optimization") goHplcStep(5);
    if (action === "optimize-gradient") runOptimization();
    if (action === "export-csv") exportHplcCsv();
    if (action === "export-excel") exportHplcExcel();
    if (action === "export-png") exportHplcPng();
    if (action === "export-hplc-json") exportHplcJson();
  }

  function handleHplcInput(event) {
    const field = event.target.dataset.hplcField;
    if (field === "flowRate" || field === "deadTime") {
      hplc[field] = event.target.value;
      markHplcUpstreamDirty();
    }
    const phaseField = event.target.dataset.phaseField;
    if (phaseField) {
      hplc.phases[Number(event.target.dataset.phaseIndex)][phaseField] = event.target.value;
      markHplcUpstreamDirty();
    }
    const pointField = event.target.dataset.pointField;
    if (pointField) {
      const rowIndex = Number(event.target.dataset.rowIndex);
      const point = hplc.points[rowIndex];
      if (pointField === "time") point.time = event.target.value;
      if (pointField === "value") {
        point.values[Number(event.target.dataset.phaseIndex)] = event.target.value;
        if (hplc.autoComplete) {
          const lastIndex = hplc.phaseCount - 1;
          const completed = Math.max(0, 100 - point.values.slice(0, lastIndex).reduce((total, value) => total + Number(value || 0), 0));
          point.values[lastIndex] = numberText(completed);
          const lastInput = app.querySelector(`[data-row-index="${rowIndex}"][data-phase-index="${lastIndex}"]`);
          if (lastInput) lastInput.value = point.values[lastIndex];
        }
      }
      updateGradientSum(rowIndex);
      markHplcUpstreamDirty();
    }
    const targetField = event.target.dataset.targetField;
    if (targetField) {
      const target = hplc.targets[Number(event.target.dataset.targetIndex)];
      target[targetField] = event.target.value;
      target.error = "";
      hplc.results = hplc.results.filter((item) => item.id !== target.id);
      hplc.selectedResultIds = hplc.selectedResultIds.filter((id) => id !== target.id);
      hplc.optimization = null;
      event.target.closest(".analyte-card")?.querySelector(".analyte-result")?.remove();
      const summary = app.querySelector("#hplc-summary-list");
      if (summary) summary.innerHTML = summaryCardsHtml();
      setBadge(resultStatus, "目标物已修改 · 待重新计算", "warning");
      saveHplcDraft();
    }
  }

  function handleHplcChange(event) {
    if (event.target.dataset.hplcField === "autoComplete") {
      hplc.autoComplete = event.target.checked;
      if (hplc.autoComplete) {
        const lastIndex = hplc.phaseCount - 1;
        hplc.points.forEach((point) => {
          point.values[lastIndex] = Math.max(0, 100 - point.values.slice(0, lastIndex).reduce((total, value) => total + Number(value || 0), 0));
        });
      }
      markHplcUpstreamDirty();
      renderHplc();
    }
    const selectedId = event.target.dataset.resultSelect;
    if (selectedId) {
      if (event.target.checked) hplc.selectedResultIds = [...new Set([...hplc.selectedResultIds, selectedId])];
      else hplc.selectedResultIds = hplc.selectedResultIds.filter((id) => id !== selectedId);
      hplc.optimization = null;
      saveHplcDraft();
      const count = app.querySelector("#selected-summary-count");
      if (count) count.textContent = hplc.step === 4
        ? `已选择 ${hplc.selectedResultIds.length} 个目标物用于下一步初步优化。`
        : `已选择 ${hplc.selectedResultIds.length} 个目标物。可返回上一步修改选择。`;
      const optimizeButton = app.querySelector('[data-action="optimize-gradient"]');
      if (optimizeButton) optimizeButton.disabled = !hplc.selectedResultIds.length;
      const mobileOptimize = mobileActionBar.querySelector('[data-mobile-action="optimize"]');
      if (mobileOptimize) mobileOptimize.disabled = !hplc.selectedResultIds.length;
      if (hplc.step === 5) {
        const result = app.querySelector("#optimization-result");
        if (result) result.innerHTML = `<div class="empty-state"><div><strong>目标物选择已改变</strong>请重新生成初步优化建议。</div></div>`;
      }
    }
  }

  function updateGradientSum(rowIndex) {
    const point = hplc.points[rowIndex];
    const sum = point.values.slice(0, hplc.phaseCount).reduce((total, value) => total + Number(value || 0), 0);
    const chip = app.querySelector(`[data-sum-row="${rowIndex}"]`);
    if (chip) {
      chip.textContent = `${numberText(sum, 3)}%`;
      chip.classList.toggle("invalid", Math.abs(sum - 100) > 0.01);
    }
  }

  function goHplcStep(step) {
    hplc.step = Math.min(5, Math.max(1, step));
    saveHplcDraft();
    renderHplc();
  }

  async function changePhaseCount(nextCount) {
    if (nextCount === hplc.phaseCount) return;
    const reducing = nextCount < hplc.phaseCount;
    if (reducing) {
      const hasData = hplc.points.some((point) => point.values.slice(nextCount, hplc.phaseCount).some((value) => Number(value) !== 0));
      if (hasData) {
        const accepted = await confirmAction({
          title: `改为 ${nextCount} 元流动相？`,
          body: `<p>${PHASE_CODES.slice(nextCount, hplc.phaseCount).join("、")} 相已填写的梯度比例将清零，当前确认版本也会失效。</p>`,
          confirmText: "清零并继续",
        });
        if (!accepted) return;
      }
    }
    hplc.phaseCount = nextCount;
    hplc.points.forEach((point) => {
      for (let index = nextCount; index < 4; index += 1) point.values[index] = 0;
      if (hplc.autoComplete) {
        const last = nextCount - 1;
        point.values[last] = Math.max(0, 100 - point.values.slice(0, last).reduce((sum, value) => sum + Number(value || 0), 0));
      }
    });
    markHplcUpstreamDirty();
    renderHplc();
  }

  function advanceHplcStepOne() {
    try {
      hplc.phases.slice(0, hplc.phaseCount).forEach((phase) => {
        if (!phase.name.trim()) throw new Error(`${phase.code} 相名称不能为空`);
      });
      if (!Number.isFinite(Number(hplc.flowRate)) || Number(hplc.flowRate) <= 0) throw new Error("流速必须大于 0");
      if (!Number.isFinite(Number(hplc.deadTime)) || Number(hplc.deadTime) < 0) throw new Error("柱死时间必须大于或等于 0");
      goHplcStep(2);
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  }

  function addGradientRow() {
    const last = hplc.points.at(-1);
    const time = Number(last?.time || 0) + 1;
    hplc.points.push({ id: uid(), time, values: last ? [...last.values] : [100, 0, 0, 0] });
    markHplcUpstreamDirty();
    renderHplc();
    requestAnimationFrame(() => app.querySelector(`[data-row-index="${hplc.points.length - 1}"][data-point-field="time"]`)?.focus());
  }

  async function deleteGradientRow(index) {
    if (hplc.points.length <= 2) {
      toast("梯度程序至少需要两个时间点", { kind: "warning" });
      return;
    }
    const removed = hplc.points.splice(index, 1)[0];
    markHplcUpstreamDirty();
    renderHplc();
    toast(`已删除 ${removed.time} min 时间点`, {
      actionLabel: "撤销",
      onAction: () => {
        hplc.points.splice(index, 0, removed);
        markHplcUpstreamDirty();
        renderHplc();
      },
    });
  }

  function confirmGradient() {
    try {
      validateHplcProgram();
      const versionNumber = (hplc.confirmed?.number || 0) + 1;
      hplc.confirmed = { number: versionNumber, version: `V${versionNumber}`, time: new Date().toISOString(), snapshot: structuredClone({ phaseCount: hplc.phaseCount, phases: hplc.phases, flowRate: hplc.flowRate, deadTime: hplc.deadTime, points: hplc.points }) };
      hplc.stale = false;
      hplc.chartAccepted = false;
      hplc.results = [];
      hplc.selectedResultIds = [];
      hplc.optimization = null;
      hplc.step = 3;
      localStorage.setItem(STORAGE.hplc, JSON.stringify(hplcSavePayload()));
      renderHplc();
      toast(`梯度已确认并创建版本 ${hplc.confirmed.version}`);
    } catch (error) {
      setBadge(resultStatus, "梯度存在错误", "danger");
      toast(error.message, { kind: "error" });
    }
  }

  function acceptGradientChart() {
    if (!hplc.confirmed || hplc.stale) {
      toast("请先重新确认梯度", { kind: "warning" });
      return;
    }
    hplc.chartAccepted = true;
    hplc.step = 4;
    saveHplcDraft();
    renderHplc();
  }

  function addTarget() {
    hplc.targets.push({ id: uid(), name: `目标物 ${hplc.targets.length + 1}`, wavelength: 254, retention: "", error: "" });
    saveHplcDraft();
    renderHplc();
    requestAnimationFrame(() => app.querySelector(`[data-target-index="${hplc.targets.length - 1}"][data-target-field="name"]`)?.select());
  }

  function deleteTarget(index) {
    const removed = hplc.targets.splice(index, 1)[0];
    hplc.results = hplc.results.filter((item) => item.id !== removed.id);
    hplc.selectedResultIds = hplc.selectedResultIds.filter((id) => id !== removed.id);
    hplc.optimization = null;
    saveHplcDraft();
    renderHplc();
    toast(`已删除“${removed.name}”`, {
      actionLabel: "撤销",
      onAction: () => {
        hplc.targets.splice(index, 0, removed);
        saveHplcDraft();
        renderHplc();
      },
    });
  }

  function calculateAllTargets() {
    if (!hplc.chartAccepted || hplc.stale) {
      toast("请先确认并接受当前梯度图", { kind: "warning" });
      return;
    }
    const results = [];
    let failures = 0;
    hplc.targets.forEach((target) => {
      try {
        target.error = "";
        results.push(calculateTarget(target));
      } catch (error) {
        target.error = error.message;
        failures += 1;
      }
    });
    hplc.results = results.sort((a, b) => hplc.phaseCount === 2 ? a.pump[1] - b.pump[1] : a.retention - b.retention);
    hplc.selectedResultIds = hplc.selectedResultIds.filter((id) => hplc.results.some((item) => item.id === id));
    hplc.optimization = null;
    saveHplcDraft();
    renderHplc();
    if (failures) toast(`${results.length} 项成功，${failures} 项失败；错误已标在对应目标物`, { kind: "warning" });
    else toast(`已计算全部 ${results.length} 个目标物`);
  }

  function runOptimization() {
    try {
      if (hplc.stale) throw new Error("当前结果已过期，请重新确认梯度并计算目标物");
      hplc.optimization = optimizeGradient();
      saveHplcDraft();
      renderHplc();
      toast(`已为 ${hplc.optimization.windows.length} 个目标物生成初步优化建议`);
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  }

  function setupChart(id, points, windows = []) {
    chartObserver?.disconnect();
    const canvas = document.querySelector(`#${id}`);
    if (!canvas) return;
    drawChart(canvas, points, windows);
    chartObserver = new ResizeObserver(() => drawChart(canvas, points, windows));
    chartObserver.observe(canvas);
    const announce = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const fraction = x / rect.width;
      const min = Number(points[0].time);
      const max = Number(points.at(-1).time);
      const time = min + fraction * (max - min);
      let values;
      try {
        values = interpolate(time, points);
      } catch {
        return;
      }
      const readout = document.querySelector(`#${id}-readout`);
      const activeWindows = windows.filter((window) => Number(window.start) <= time && time <= Number(window.end));
      const windowText = activeWindows.length ? `；潜在洗脱窗口：${activeWindows.map((window) => window.target).join("、")}` : "";
      if (readout) readout.textContent = `${numberText(time, 2)} min：${compositionText(values)}${windowText}`;
    };
    canvas.addEventListener("pointermove", announce);
    canvas.addEventListener("pointerdown", announce);
  }

  function layoutWindowLabels(ctx, windows, timeToX, width, leftEdge, rightEdge) {
    const rowEnds = [];
    return windows.map((window, index) => {
      const text = `${window.target} · ${numberText(window.center, 2)} min · ±15 s`;
      const labelWidth = Math.min(width < 500 ? 132 : 190, Math.max(88, ctx.measureText(text).width + 18));
      const centerX = timeToX(Number(window.center));
      const labelLeft = Math.max(leftEdge, Math.min(rightEdge - labelWidth, centerX - labelWidth / 2));
      let row = rowEnds.findIndex((end) => labelLeft > end + 6);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(labelLeft + labelWidth);
      } else {
        rowEnds[row] = labelLeft + labelWidth;
      }
      return { ...window, color: WINDOW_COLORS[index % WINDOW_COLORS.length], text, labelWidth, labelLeft, centerX, row };
    });
  }

  function drawWindowBands(ctx, layouts, padding, plotH, timeToX) {
    layouts.forEach((window) => {
      const startX = timeToX(Number(window.start));
      const endX = timeToX(Number(window.end));
      ctx.save();
      ctx.fillStyle = window.color;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(startX, padding.top, Math.max(2, endX - startX), plotH);
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = window.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const x of [startX, endX]) {
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + plotH);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(window.centerX, padding.top);
      ctx.lineTo(window.centerX, padding.top + plotH);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawWindowLabels(ctx, layouts) {
    ctx.save();
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    layouts.forEach((window) => {
      const labelTop = 10 + window.row * 24;
      const labelHeight = 20;
      const leaderEnd = labelTop + labelHeight;
      ctx.strokeStyle = window.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(window.centerX, leaderEnd);
      ctx.lineTo(window.centerX, leaderEnd + 6);
      ctx.stroke();
      ctx.fillStyle = window.color;
      ctx.beginPath();
      ctx.roundRect(window.labelLeft, labelTop, window.labelWidth, labelHeight, 6);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      const visibleText = window.labelWidth < 145 ? `${window.target} · ${numberText(window.center, 2)}` : window.text;
      ctx.fillText(visibleText, window.labelLeft + window.labelWidth / 2, labelTop + labelHeight / 2, window.labelWidth - 10);
    });
    ctx.restore();
  }

  function drawChart(canvas, points, windows = []) {
    if (!canvas || !points?.length) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(320, Math.floor(rect.width * ratio));
    canvas.height = Math.max(280, Math.floor(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    const padding = { left: width < 500 ? 42 : 58, right: 20, top: 24, bottom: 42 };
    const plotW = width - padding.left - padding.right;
    const minTime = Number(points[0].time);
    const maxTime = Number(points.at(-1).time);
    const span = Math.max(0.0001, maxTime - minTime);
    const timeToX = (time) => padding.left + (time - minTime) / span * plotW;
    ctx.font = "700 11px system-ui, sans-serif";
    const windowLayouts = layoutWindowLabels(ctx, windows, timeToX, width, padding.left, width - padding.right);
    const labelRows = windowLayouts.length ? Math.max(...windowLayouts.map((window) => window.row)) + 1 : 0;
    padding.top = labelRows ? 18 + labelRows * 24 : 24;
    const plotH = Math.max(120, height - padding.top - padding.bottom);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    if (windowLayouts.length) drawWindowBands(ctx, windowLayouts, padding, plotH, timeToX);
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let value = 0; value <= 100; value += 20) {
      const y = padding.top + plotH - value / 100 * plotH;
      ctx.strokeStyle = "#e5ebf3";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = "#667085";
      ctx.fillText(`${value}%`, padding.left - 8, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = Math.min(5, Math.max(2, points.length));
    for (let index = 0; index < ticks; index += 1) {
      const fraction = index / (ticks - 1);
      const x = padding.left + fraction * plotW;
      const time = minTime + fraction * span;
      ctx.fillStyle = "#667085";
      ctx.fillText(`${numberText(time, 2)} min`, x, padding.top + plotH + 12);
    }
    for (let phaseIndex = 0; phaseIndex < hplc.phaseCount; phaseIndex += 1) {
      if (ui.hiddenPhases.has(phaseIndex)) continue;
      ctx.strokeStyle = CHART_COLORS[phaseIndex];
      ctx.fillStyle = CHART_COLORS[phaseIndex];
      ctx.lineWidth = 3;
      ctx.setLineDash(phaseIndex === 1 ? [8, 5] : phaseIndex === 2 ? [3, 4] : phaseIndex === 3 ? [10, 4, 2, 4] : []);
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = padding.left + (Number(point.time) - minTime) / span * plotW;
        const y = padding.top + plotH - Number(point.values[phaseIndex]) / 100 * plotH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      points.forEach((point) => {
        const x = padding.left + (Number(point.time) - minTime) / span * plotW;
        const y = padding.top + plotH - Number(point.values[phaseIndex]) / 100 * plotH;
        ctx.beginPath();
        if (phaseIndex % 2 === 0) ctx.arc(x, y, 4, 0, Math.PI * 2);
        else ctx.rect(x - 4, y - 4, 8, 8);
        ctx.fill();
      });
    }
    if (windowLayouts.length) drawWindowLabels(ctx, windowLayouts);
  }

  async function resetHplc() {
    const accepted = await confirmAction({
      title: "新建 HPLC 方案？",
      body: "<p>当前草稿会被清空。若需保留，请先下载方案文件。</p>",
      confirmText: "新建方案",
    });
    if (!accepted) return;
    hplc = defaultHplc();
    localStorage.setItem(STORAGE.hplc, JSON.stringify(hplcSavePayload()));
    renderHplc();
  }

  function exportHplcJson() {
    const payload = { format: "lab-calculator-hplc", version: 1, data: hplcSavePayload() };
    download("HPLC梯度方案.labhplc.json", JSON.stringify(payload, null, 2));
    toast("已下载 HPLC 方案文件");
  }

  function importHplc() {
    openFile(async (text, filename) => {
      const payload = JSON.parse(text);
      if (payload.format !== "lab-calculator-hplc" || !payload.data?.points) throw new Error("该文件不是有效的 HPLC 梯度方案");
      const accepted = await confirmAction({
        title: "导入 HPLC 方案？",
        body: `<p>文件：<strong>${e(filename)}</strong></p><p>包含 ${payload.data.points.length} 个梯度时间点、${payload.data.targets?.length || 0} 个目标物。导入后会替换当前草稿，结果需重新确认。</p>`,
        confirmText: "导入并替换",
      });
      if (!accepted) return;
      hplc = { ...defaultHplc(), ...payload.data, confirmed: null, chartAccepted: false, stale: false, results: [], selectedResultIds: [], optimization: null, step: 1 };
      localStorage.setItem(STORAGE.hplc, JSON.stringify(hplcSavePayload()));
      renderHplc();
      toast("HPLC 方案已导入，请重新确认梯度");
    });
  }

  function exportHplcCsv() {
    if (!hplc.results.length || hplc.stale) return;
    const rows = [
      ["HPLC梯度程序辅助计算结果"],
      ["导出时间", new Date().toISOString()],
      ["流动相元数", hplc.phaseCount],
      ["流速(mL/min)", hplc.flowRate],
      ["柱死时间(min)", hplc.deadTime],
      [],
      ["梯度程序"],
      ["时间(min)", ...PHASE_CODES.slice(0, hplc.phaseCount).map((code) => `${code}相(%)`)],
      ...hplc.points.map((point) => [point.time, ...point.values.slice(0, hplc.phaseCount)]),
      [],
      ["目标物", "检测波长(nm)", "出峰时间(min)", "泵端比例", "柱出口比例", "说明"],
      ...hplc.results.map((result) => [result.name, result.wavelength, result.retention, compositionText(result.pump), compositionText(result.column), result.note]),
      [],
      ["科学性说明", "结果为基于线性梯度与柱死时间的简化估算，必须通过混合标准品和实际系统验证。"],
    ];
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    download("HPLC洗脱窗口结果.csv", csv, "text/csv;charset=utf-8");
    toast("已导出 CSV 结果");
  }

  function exportHplcExcel() {
    if (!hplc.results.length || hplc.stale) return;
    const rows = [
      ["目标物", "检测波长(nm)", "出峰时间(min)", "泵端比例", "柱出口比例", "说明"],
      ...hplc.results.map((result) => [result.name, result.wavelength, result.retention, compositionText(result.pump), compositionText(result.column), result.note]),
    ];
    const html = `<!doctype html><meta charset="utf-8"><table>${rows.map((row, index) => `<tr>${row.map((cell) => `<${index ? "td" : "th"}>${e(cell)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("")}</table><p>结果为简化估算，必须通过混合标准品和实际系统验证。</p>`;
    download("HPLC洗脱窗口结果.xls", html, "application/vnd.ms-excel;charset=utf-8");
    toast("已导出 Excel 可读文件");
  }

  function exportHplcPng() {
    const source = hplc.step === 5 && hplc.optimization ? document.querySelector("#optimized-chart") : document.querySelector("#gradient-chart");
    if (source) {
      source.toBlob((blob) => {
        if (blob) download("HPLC梯度图.png", blob, "image/png");
      });
      toast("已导出梯度图 PNG");
      return;
    }
    hplc.step = hplc.optimization ? 5 : 3;
    renderHplc();
    requestAnimationFrame(() => {
      const canvas = document.querySelector(hplc.optimization ? "#optimized-chart" : "#gradient-chart");
      canvas?.toBlob((blob) => blob && download("HPLC梯度图.png", blob, "image/png"));
    });
  }

  async function route() {
    chartObserver?.disconnect();
    const path = location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
    if (path === "solution") renderSolution();
    else if (path === "dissolution") {
      setShell({ title: "溶出介质配制辅助", result: "正在加载介质目录", resultKind: "info" });
      app.innerHTML = `<div class="page"><div class="empty-state"><div><strong>正在加载介质目录</strong>共 365 个可选处方，请稍候。</div></div></div>`;
      await loadMediaCatalog();
      renderDissolution();
    } else if (path === "hplc") renderHplc();
    else if (path === "concentration") renderConcentration();
    else renderHome();
    focusMain();
  }

  addEventListener("hashchange", route);
  route();
})();
