(() => {
  const tableBody = document.getElementById("saved-table-body");
  if (!tableBody) return;

  const groupBy = document.getElementById("saved-group-by");
  const directionFilter = document.getElementById("saved-direction-filter");
  const sortBy = document.getElementById("saved-sort");
  const pageSize = document.getElementById("saved-page-size");
  const searchInput = document.getElementById("saved-search");
  const resetButton = document.getElementById("saved-reset");
  const previousButton = document.getElementById("saved-prev-page");
  const nextButton = document.getElementById("saved-next-page");
  const pageInfo = document.getElementById("saved-page-info");
  const transactionRows = Array.from(
    document.querySelectorAll(".saved-transaction-row")
  );
  const moneyFormatter = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2
  });
  let currentPage = 1;

  function rowAmount(row) {
    const value = Number.parseFloat(row.dataset.amount || "");
    return Number.isFinite(value) ? value : 0;
  }

  function rowDate(row) {
    return row.dataset.date || "";
  }

  function rowDirection(row) {
    return rowAmount(row) >= 0 ? "in" : "out";
  }

  function formatThaiDate(value, options) {
    if (!value) return "ไม่ระบุวันที่";
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "ไม่ระบุวันที่";
    return new Intl.DateTimeFormat("th-TH", options).format(parsed);
  }

  function groupKey(row) {
    const mode = groupBy?.value || "none";
    const value = rowDate(row);
    if (mode === "direction") return rowDirection(row);
    if (mode === "day") return value || "unknown";
    if (mode === "month") return value ? value.slice(0, 7) : "unknown";
    if (mode === "year") return value ? value.slice(0, 4) : "unknown";
    if (mode === "status") return row.dataset.status || "unknown";
    if (mode === "card") return row.dataset.card || "unknown";
    if (mode === "category") return row.dataset.category || "unknown";
    return "all";
  }

  function groupLabel(key, rows) {
    const mode = groupBy?.value || "none";
    if (mode === "direction") return key === "in" ? "เงินเข้า" : "เงินออก";
    if (mode === "status") {
      return rows[0]?.dataset.statusLabel || "ไม่ระบุสถานะ";
    }
    if (mode === "card") return key === "unknown" ? "ไม่ระบุบัตร" : `บัตร •••• ${key}`;
    if (mode === "category") {
      return key === "unknown" ? "ไม่ระบุหมวดหมู่" : key;
    }
    if (key === "unknown") return "ไม่ระบุวันที่";
    if (mode === "day") {
      return formatThaiDate(key, {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }
    if (mode === "month") {
      return formatThaiDate(`${key}-01`, { month: "long", year: "numeric" });
    }
    if (mode === "year") {
      return formatThaiDate(`${key}-01-01`, { year: "numeric" });
    }
    return "รายการทั้งหมด";
  }

  function matchesFilters(row) {
    const wantedDirection = directionFilter?.value || "all";
    if (
      wantedDirection !== "all" &&
      rowDirection(row) !== wantedDirection
    ) {
      return false;
    }
    const query = (searchInput?.value || "")
      .trim()
      .toLocaleLowerCase("th-TH");
    if (!query) return true;
    return row.textContent.toLocaleLowerCase("th-TH").includes(query);
  }

  function compareRows(left, right) {
    const mode = sortBy?.value || "date-desc";
    if (mode === "date-asc") return rowDate(left).localeCompare(rowDate(right));
    if (mode === "date-desc") return rowDate(right).localeCompare(rowDate(left));
    if (mode === "amount-desc") {
      return Math.abs(rowAmount(right)) - Math.abs(rowAmount(left));
    }
    if (mode === "amount-asc") {
      return Math.abs(rowAmount(left)) - Math.abs(rowAmount(right));
    }
    return (
      Number(left.dataset.originalOrder) - Number(right.dataset.originalOrder)
    );
  }

  function summarize(rows) {
    const incoming = rows.reduce(
      (sum, row) => sum + Math.max(rowAmount(row), 0),
      0
    );
    const outgoing = rows.reduce(
      (sum, row) => sum + Math.abs(Math.min(rowAmount(row), 0)),
      0
    );
    return {
      count: rows.length,
      incoming,
      outgoing,
      net: incoming - outgoing
    };
  }

  function makeTextElement(tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function makeGroupRow(key, rows) {
    const summary = summarize(rows);
    const groupRow = document.createElement("tr");
    groupRow.className = "preview-group-row saved-group-row";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    const content = document.createElement("div");
    content.appendChild(makeTextElement("strong", groupLabel(key, rows)));
    content.appendChild(
      makeTextElement(
        "span",
        `${summary.count.toLocaleString("th-TH")} รายการ`
      )
    );
    content.appendChild(
      makeTextElement(
        "span",
        `เข้า ${moneyFormatter.format(summary.incoming)}`,
        "group-in"
      )
    );
    content.appendChild(
      makeTextElement(
        "span",
        `ออก ${moneyFormatter.format(summary.outgoing)}`,
        "group-out"
      )
    );
    content.appendChild(
      makeTextElement("span", `สุทธิ ${moneyFormatter.format(summary.net)}`)
    );
    cell.appendChild(content);
    groupRow.appendChild(cell);
    return groupRow;
  }

  function updateSummary(rows) {
    const summary = summarize(rows);
    document.getElementById("saved-visible-count").textContent =
      summary.count.toLocaleString("th-TH");
    document.getElementById("saved-visible-in").textContent =
      moneyFormatter.format(summary.incoming);
    document.getElementById("saved-visible-out").textContent =
      moneyFormatter.format(summary.outgoing);
    document.getElementById("saved-visible-net").textContent =
      moneyFormatter.format(summary.net);
  }

  function renderTable() {
    const filteredRows = transactionRows.filter(matchesFilters).sort(compareRows);
    const requestedPageSize = Number.parseInt(pageSize?.value || "50", 10);
    const effectivePageSize =
      requestedPageSize > 0 ? requestedPageSize : Math.max(filteredRows.length, 1);
    const totalPages = Math.max(
      1,
      Math.ceil(filteredRows.length / effectivePageSize)
    );
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (currentPage - 1) * effectivePageSize;
    const pageRows = filteredRows.slice(start, start + effectivePageSize);

    tableBody.replaceChildren();
    let visibleIndex = start;
    if ((groupBy?.value || "none") !== "none") {
      const groups = new Map();
      pageRows.forEach((row) => {
        const key = groupKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      groups.forEach((rows, key) => {
        tableBody.appendChild(makeGroupRow(key, rows));
        rows.forEach((row) => {
          visibleIndex += 1;
          row.querySelector(".saved-row-number").textContent =
            visibleIndex.toLocaleString("th-TH");
          tableBody.appendChild(row);
        });
      });
    } else {
      pageRows.forEach((row) => {
        visibleIndex += 1;
        row.querySelector(".saved-row-number").textContent =
          visibleIndex.toLocaleString("th-TH");
        tableBody.appendChild(row);
      });
    }

    updateSummary(filteredRows);
    pageInfo.textContent =
      `หน้า ${currentPage.toLocaleString("th-TH")} / ` +
      `${totalPages.toLocaleString("th-TH")} · ` +
      `${filteredRows.length.toLocaleString("th-TH")} รายการ`;
    previousButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;
  }

  [groupBy, directionFilter, sortBy, pageSize].forEach((control) => {
    control?.addEventListener("change", () => {
      currentPage = 1;
      renderTable();
    });
  });
  searchInput?.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });
  previousButton?.addEventListener("click", () => {
    currentPage -= 1;
    renderTable();
  });
  nextButton?.addEventListener("click", () => {
    currentPage += 1;
    renderTable();
  });
  resetButton?.addEventListener("click", () => {
    groupBy.value = "none";
    directionFilter.value = "all";
    sortBy.value = "date-desc";
    pageSize.value = "50";
    searchInput.value = "";
    currentPage = 1;
    renderTable();
  });

  renderTable();
})();
