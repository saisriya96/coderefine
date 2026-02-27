/* ===================================================
   CodeRefine – Frontend Logic
   =================================================== */

const codeInput      = document.getElementById("codeInput");
const lineNumbers    = document.getElementById("lineNumbers");
const charCount      = document.getElementById("charCount");
const languageSel    = document.getElementById("language");
const reviewBtn      = document.getElementById("reviewBtn");
const btnText        = document.getElementById("btnText");
const btnSpinner     = document.getElementById("btnSpinner");
const clearBtn       = document.getElementById("clearBtn");
const resultsSection = document.getElementById("resultsSection");
const errorBanner    = document.getElementById("errorBanner");
const errorMsg       = document.getElementById("errorMsg");
const issuesList     = document.getElementById("issuesList");
const issueCount     = document.getElementById("issueCount");
const improvedCode   = document.getElementById("improvedCode");
const explanationText= document.getElementById("explanationText");
const scoreValue     = document.getElementById("scoreValue");
const scoreBar       = document.getElementById("scoreBar");
const copyBtn        = document.getElementById("copyBtn");

const MAX_CHARS = 5000;

/* ── Line numbers ── */
function updateLineNumbers() {
  const lines = codeInput.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
}

/* ── Char counter ── */
function updateCharCount() {
  const len = codeInput.value.length;
  charCount.textContent = `${len} / ${MAX_CHARS} chars`;
  charCount.classList.toggle("warn", len > MAX_CHARS * 0.85);
}

codeInput.addEventListener("input", () => {
  updateLineNumbers();
  updateCharCount();
});

/* Keep line numbers in sync with scroll */
codeInput.addEventListener("scroll", () => {
  lineNumbers.scrollTop = codeInput.scrollTop;
});

/* Handle Tab key & Ctrl+Enter shortcut */
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = codeInput.selectionStart;
    const end   = codeInput.selectionEnd;
    codeInput.value = codeInput.value.substring(0, start) + "  " + codeInput.value.substring(end);
    codeInput.selectionStart = codeInput.selectionEnd = start + 2;
    updateLineNumbers();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!reviewBtn.disabled) reviewBtn.click();
  }
});

/* ── Clear button ── */
clearBtn.addEventListener("click", () => {
  codeInput.value = "";
  updateLineNumbers();
  updateCharCount();
  hideResults();
  hideError();
});

/* ── Copy button ── */
copyBtn.addEventListener("click", () => {
  const text = improvedCode.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 2000);
  });
});

/* ── Download button ── */
const downloadBtn = document.getElementById("downloadBtn");
downloadBtn.addEventListener("click", () => {
  const code = improvedCode.textContent;
  const lang = languageSel.value.toLowerCase();
  const extMap = {
    python: "py", javascript: "js", typescript: "ts", java: "java",
    c: "c", "c++": "cpp", "c#": "cs", go: "go", rust: "rs",
    php: "php", ruby: "rb", swift: "swift", kotlin: "kt",
    sql: "sql", html: "html", css: "css"
  };
  const ext = extMap[lang] || "txt";
  const blob = new Blob([code], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `improved_code.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Helpers ── */
function setLoading(loading) {
  reviewBtn.disabled = loading;
  btnText.classList.toggle("hidden", loading);
  btnSpinner.classList.toggle("hidden", !loading);
}

function hideResults() {
  resultsSection.classList.add("hidden");
}

function hideError() {
  errorBanner.classList.add("hidden");
}

function showError(msg, retryAfter = 0) {
  errorMsg.textContent = msg;
  errorBanner.classList.remove("hidden");
  hideResults();

  if (retryAfter > 0) {
    let secs = retryAfter;
    reviewBtn.disabled = true;
    const interval = setInterval(() => {
      secs--;
      btnText.textContent = `⏳ Retry in ${secs}s`;
      if (secs <= 0) {
        clearInterval(interval);
        reviewBtn.disabled = false;
        btnText.textContent = "✨ Debug & Review";
      }
    }, 1000);
  }
}

/* ── Score bar color ── */
function scoreColor(score) {
  if (score >= 80) return "linear-gradient(90deg, #00d4aa, #00f5c8)";
  if (score >= 50) return "linear-gradient(90deg, #f59e0b, #fcd34d)";
  return "linear-gradient(90deg, #ff4f4f, #ff8080)";
}

/* ── Issue icon ── */
function issueIcon(type) {
  if (type === "bug")        return "🐛";
  if (type === "error")      return "❌";
  if (type === "warning")    return "⚠️";
  return "💡";
}

/* ── Render results ── */
function renderResults(data) {
  /* Score */
  const score = typeof data.score === "number" ? Math.min(100, Math.max(0, Math.round(data.score))) : null;
  if (score !== null) {
    scoreValue.textContent = score + " / 100";
    scoreBar.style.background = scoreColor(score);
    /* Animate bar after a tiny delay so transition fires */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scoreBar.style.width = score + "%";
      });
    });
  } else {
    scoreValue.textContent = "—";
    scoreBar.style.width = "0";
  }

  /* Issues */
  const issues = Array.isArray(data.issues) ? data.issues : [];
  issueCount.textContent = issues.length;

  if (issues.length === 0) {
    issuesList.innerHTML = '<p class="no-issues">No issues found – great code! 🎉</p>';
  } else {
    issuesList.innerHTML = issues.map(issue => {
      const type = (issue.type || "suggestion").toLowerCase();
      const safeType = ["bug", "error", "warning", "suggestion"].includes(type) ? type : "suggestion";
      return `
        <div class="issue-item ${safeType}">
          <span class="issue-icon">${issueIcon(safeType)}</span>
          <div class="issue-body">
            <div class="issue-meta">
              <span class="issue-type">${safeType}</span>
              <span class="issue-line">${escapeHtml(issue.line || "")}</span>
            </div>
            <span class="issue-desc">${escapeHtml(issue.description || "")}</span>
          </div>
        </div>`;
    }).join("");
  }

  /* Improved code */
  const code = data.improved_code || "";
  improvedCode.textContent = code;

  /* Apply syntax highlighting */
  const lang = languageSel.value.toLowerCase();
  improvedCode.className = `language-${lang}`;
  if (window.hljs) {
    try { hljs.highlightElement(improvedCode); } catch (_) {}
  }

  /* Explanation */
  explanationText.textContent = data.explanation || "No explanation provided.";

  /* Show section */
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Escape HTML ── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Review button ── */
reviewBtn.addEventListener("click", async () => {
  const code     = codeInput.value.trim();
  const language = languageSel.value;

  if (!code) {
    showError("Please paste some code before clicking Debug & Review.");
    return;
  }

  if (code.length > MAX_CHARS) {
    showError(`Code is too long (${code.length} chars). Please limit to ${MAX_CHARS} characters.`);
    return;
  }

  hideError();
  hideResults();
  setLoading(true);

  try {
    const response = await fetch("/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      showError(data.error || "An unexpected error occurred.", data.retry_after || 0);
      return;
    }

    renderResults(data);
  } catch (err) {
    showError("Network error – make sure the Flask server is running.");
  } finally {
    setLoading(false);
  }
});

/* ── Init ── */
updateLineNumbers();
updateCharCount();
