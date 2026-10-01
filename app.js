(() => {
  const $ = (id) => document.getElementById(id);
  const LABELS = { "emails.json": "Landing page", "blog-emails.json": "Blog" };
  const state = { files: [], current: null, raw: "", data: [], sort: { k: "subscribedAt", dir: -1 } };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? String(iso ?? "") : d.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
  };

  function showError(msg) { $("error").textContent = msg || ""; $("error").classList.toggle("hidden", !msg); }

  async function loadSources() {
    const res = await fetch("/api/sources");
    const s = await res.json();
    state.files = s.files;
    $("source").textContent = s.mode === "s3" ? `S3 · ${s.bucket}` : "Local file";
    $("files").innerHTML = "";
    s.files.forEach((f) => {
      const b = document.createElement("button");
      b.textContent = LABELS[f] ? `${LABELS[f]} (${f})` : f;
      b.dataset.name = f;
      b.onclick = () => loadFile(f);
      $("files").appendChild(b);
    });
    if (s.files.length === 1) $("files").classList.add("hidden");
    await loadFile(state.current && s.files.includes(state.current) ? state.current : s.files[0]);
  }

  async function loadFile(name) {
    state.current = name;
    [...$("files").children].forEach((b) => b.classList.toggle("active", b.dataset.name === name));
    showError("");
    $("status").textContent = "Loading…";
    try {
      const res = await fetch("/api/file?name=" + encodeURIComponent(name));
      const text = await res.text();
      if (!res.ok) throw new Error(JSON.parse(text).error || res.statusText);
      state.raw = text;
      const parsed = JSON.parse(text);
      state.data = Array.isArray(parsed) ? parsed : [];
      if (!Array.isArray(parsed)) showError("File is valid JSON but not an array – showing raw view only.");
      $("json").textContent = JSON.stringify(parsed, null, 2);
      const langs = [...new Set(state.data.map((r) => r.language).filter(Boolean))].sort();
      $("lang").innerHTML = '<option value="">All languages</option>' + langs.map((l) => `<option>${l}</option>`).join("");
      render();
    } catch (e) {
      state.data = []; render();
      showError("Could not load " + name + ": " + e.message);
      $("status").textContent = "";
    }
  }

  function visibleRows() {
    const q = $("search").value.trim().toLowerCase();
    const lang = $("lang").value;
    const { k, dir } = state.sort;
    return state.data
      .filter((r) => (!lang || r.language === lang) && (!q || `${r.email} ${r.ipAddress}`.toLowerCase().includes(q)))
      .sort((a, b) => (String(a[k] ?? "") < String(b[k] ?? "") ? -1 : 1) * dir);
  }

  function render() {
    const all = state.data;
    const count = (l) => all.filter((r) => r.language === l).length;
    const latest = all.map((r) => r.subscribedAt).sort().pop();
    const stats = [["Total", all.length], ["DE", count("de")], ["EN", count("en")], ["Latest", latest ? fmtDate(latest) : "–"]];
    $("stats").innerHTML = "";
    stats.forEach(([l, n]) => {
      const d = document.createElement("div"); d.className = "stat";
      d.innerHTML = '<div class="n"></div><div class="l"></div>';
      d.firstChild.textContent = n; d.lastChild.textContent = l;
      $("stats").appendChild(d);
    });

    const rows = visibleRows();
    $("rows").innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const mk = (txt, cls) => { const td = document.createElement("td"); if (cls) { const s = document.createElement("span"); s.className = cls; s.textContent = txt; td.appendChild(s); } else td.textContent = txt; return td; };
      tr.append(mk(r.email ?? ""), mk(r.language ?? "", "lang"), mk(fmtDate(r.subscribedAt)), mk(r.ipAddress ?? ""));
      $("rows").appendChild(tr);
    });
    $("empty").classList.toggle("hidden", rows.length > 0);
    document.querySelectorAll("th").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.k === state.sort.k);
      th.classList.toggle("asc", th.dataset.k === state.sort.k && state.sort.dir === 1);
    });
    $("status").textContent = state.current ? `${rows.length} of ${all.length} entries · ${state.current}` : "";
  }

  function setView(json) {
    $("viewTable").classList.toggle("active", !json);
    $("viewJson").classList.toggle("active", json);
    $("tableWrap").classList.toggle("hidden", json);
    $("json").classList.toggle("hidden", !json);
    $("tableTools").classList.toggle("hidden", json);
    $("copyJson").classList.toggle("hidden", !json);
  }

  const flash = (btn, txt) => { const o = btn.textContent; btn.textContent = txt; setTimeout(() => (btn.textContent = o), 1200); };

  $("viewTable").onclick = () => setView(false);
  $("viewJson").onclick = () => setView(true);
  $("refresh").onclick = loadSources;
  $("search").oninput = $("lang").onchange = render;
  document.querySelectorAll("th").forEach((th) => (th.onclick = () => {
    const k = th.dataset.k;
    state.sort = { k, dir: state.sort.k === k ? -state.sort.dir : 1 };
    render();
  }));
  $("copy").onclick = async () => {
    await navigator.clipboard.writeText(visibleRows().map((r) => r.email).join("\n"));
    flash($("copy"), "Copied ✓");
  };
  $("copyJson").onclick = async () => { await navigator.clipboard.writeText($("json").textContent); flash($("copyJson"), "Copied ✓"); };
  $("csv").onclick = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["email,language,subscribedAt,ipAddress", ...visibleRows().map((r) => [r.email, r.language, r.subscribedAt, r.ipAddress].map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "konihaus-subscribers.csv";
    a.click();
  };

  loadSources().catch((e) => showError("Cannot reach local server: " + e.message));
})();
