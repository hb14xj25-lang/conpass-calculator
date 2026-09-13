(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ConpassModel = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PAC_PMOL_PER_PG_ML = 2.77;
  var THRESHOLDS = {
    potassiumMax: 3.5,
    pacMinPgMl: 200,
    reninMaxMuL: 5,
    noduleMinMm: 10
  };

  var HARD_LIMITS = {
    potassium: { min: 1, max: 10, unit: "mmol/L" },
    pacPgMl: { min: 0, max: 5000, unit: "pg/mL" },
    renin: { min: 0, max: 200, unit: "mU/L" },
    noduleMm: { min: 0, max: 100, unit: "mm" }
  };

  var CT_LABELS = {
    single: "单侧结节",
    none: "无结节",
    bilateral: "双侧结节",
    unclear: "影像不确定"
  };

  function numberOrNaN(value) {
    if (value === null || value === undefined || value === "") return NaN;
    return Number(value);
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits || 0);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function normalizePac(value, unit) {
    var n = numberOrNaN(value);
    if (unit === "pmol/L") return n / PAC_PMOL_PER_PG_ML;
    return n;
  }

  function normalizeNodule(value, unit) {
    var n = numberOrNaN(value);
    if (unit === "cm") return n * 10;
    return n;
  }

  function outside(value, limit) {
    return Number.isFinite(value) && (value < limit.min || value > limit.max);
  }

  function addIssue(list, code, severity, title, detail) {
    list.push({ code: code, severity: severity, title: title, detail: detail });
  }

  function evaluate(input) {
    var potassium = numberOrNaN(input.potassium);
    var pacPgMl = normalizePac(input.pac, input.pacUnit || "pg/mL");
    var renin = numberOrNaN(input.renin);
    var ct = input.ct || "single";
    var noduleMm = normalizeNodule(input.nodule, input.noduleUnit || "mm");
    var confirmedPa = input.confirmedPa !== false;
    var reninMethod = input.reninMethod || "drc";
    var pacMethod = input.pacMethod || "immunoassay";

    var issues = [];
    if (!Number.isFinite(potassium)) addIssue(issues, "missing_potassium", "error", "缺少血清钾", "请填写血清钾。");
    if (!Number.isFinite(pacPgMl)) addIssue(issues, "missing_pac", "error", "缺少 PAC", "请填写血浆醛固酮浓度。");
    if (!Number.isFinite(renin)) addIssue(issues, "missing_renin", "error", "缺少肾素", "请填写直接肾素浓度 DRC。");
    if (ct === "single" && !Number.isFinite(noduleMm)) addIssue(issues, "missing_nodule", "error", "缺少结节直径", "单侧结节时请填写最大直径。");

    if (outside(potassium, HARD_LIMITS.potassium)) addIssue(issues, "potassium_out_of_range", "error", "血清钾超出硬校验范围", "请核对血清钾是否在 1-10 mmol/L。");
    if (outside(pacPgMl, HARD_LIMITS.pacPgMl)) addIssue(issues, "pac_out_of_range", "error", "PAC 超出硬校验范围", "请核对 PAC 换算后是否在 0-5000 pg/mL。");
    if (outside(renin, HARD_LIMITS.renin)) addIssue(issues, "renin_out_of_range", "error", "肾素超出硬校验范围", "请核对 DRC 是否在 0-200 mU/L。");
    if (ct === "single" && outside(noduleMm, HARD_LIMITS.noduleMm)) addIssue(issues, "nodule_out_of_range", "error", "结节直径超出硬校验范围", "请核对结节最大径是否在 0-100 mm。");

    if (Number.isFinite(potassium) && (potassium < 2 || potassium > 6.5)) addIssue(issues, "potassium_extreme", "warning", "血清钾明显偏离常见范围", "请核对标本、单位和录入值。");
    if (Number.isFinite(pacPgMl) && pacPgMl > 1000) addIssue(issues, "pac_extrapolated", "warning", "PAC 高于原研究常见测定上限", "模型仍按阈值判断，但属于外推使用，应在结果解读中降级。");
    if (Number.isFinite(renin) && renin < 0.53) addIssue(issues, "renin_below_lod", "warning", "肾素低于原研究检测下限", "请核对报告是否为 DRC mU/L，以及是否低于检测下限。");
    if (ct === "single" && Number.isFinite(noduleMm) && noduleMm > 50) addIssue(issues, "large_nodule", "warning", "结节直径较大", "请核对单位，并结合影像特征排除其他肾上腺病变。");

    if (!confirmedPa) addIssue(issues, "not_confirmed_pa", "scope", "尚未确认 PA 诊断", "CONPASS 是分型辅助规则，不应用作 PA 初筛。");
    if (reninMethod !== "drc") addIssue(issues, "renin_method_not_drc", "scope", "肾素方法不匹配", "PRA 与 DRC 不是同一指标，不能直接套用 mU/L 切点。");
    if (pacMethod === "lcms") addIssue(issues, "pac_method_lcms", "scope", "PAC 检测方法不匹配", "LC-MS/MS 与免疫法切点不同，需重新验证或按指南对应阈值解释。");
    if (ct !== "single") addIssue(issues, "ct_not_single", "scope", "CT 不是明确单侧结节", "无结节、双侧结节或影像不确定时，模型不支持免 AVS 判断。");

    var criteria = {
      potassium: Number.isFinite(potassium) && potassium <= THRESHOLDS.potassiumMax,
      pac: Number.isFinite(pacPgMl) && pacPgMl >= THRESHOLDS.pacMinPgMl,
      renin: Number.isFinite(renin) && renin <= THRESHOLDS.reninMaxMuL,
      ct: ct === "single" && Number.isFinite(noduleMm) && noduleMm >= THRESHOLDS.noduleMinMm
    };

    var hasError = issues.some(function (x) { return x.severity === "error"; });
    var hasScopeIssue = issues.some(function (x) { return x.severity === "scope"; });
    var allCriteria = criteria.potassium && criteria.pac && criteria.renin && criteria.ct;
    var status = "not_all_criteria";
    if (hasError) status = "invalid";
    else if (hasScopeIssue) status = "not_applicable";
    else if (allCriteria) status = "conpass_positive";

    return {
      status: status,
      allCriteria: allCriteria,
      normalized: {
        potassium: potassium,
        pacPgMl: pacPgMl,
        renin: renin,
        ct: ct,
        ctLabel: CT_LABELS[ct] || ct,
        noduleMm: noduleMm
      },
      criteria: criteria,
      issues: issues,
      thresholds: THRESHOLDS
    };
  }

  function makeAuditCases(count, seed) {
    var cases = [];
    var kVals = [3.49, 3.5, 3.51];
    var pacVals = [199.9, 200, 200.1];
    var reninVals = [4.99, 5, 5.01];
    var noduleVals = [9.9, 10, 10.1];

    kVals.forEach(function (k) {
      pacVals.forEach(function (pac) {
        reninVals.forEach(function (renin) {
          noduleVals.forEach(function (nodule) {
            cases.push({ name: "grid", potassium: k, pac: pac, pacUnit: "pg/mL", renin: renin, ct: "single", nodule: nodule, noduleUnit: "mm" });
          });
        });
      });
    });

    [
      ["pmol_553.9_below", 553.9],
      ["pmol_554_exact", 554],
      ["pmol_554.1_above", 554.1]
    ].forEach(function (row) {
      cases.push({ name: row[0], potassium: 3.5, pac: row[1], pacUnit: "pmol/L", renin: 5, ct: "single", nodule: 10, noduleUnit: "mm" });
    });

    [
      ["cm_0.99_below", 0.99],
      ["cm_1.00_exact", 1],
      ["cm_1.01_above", 1.01]
    ].forEach(function (row) {
      cases.push({ name: row[0], potassium: 3.5, pac: 200, pacUnit: "pg/mL", renin: 5, ct: "single", nodule: row[1], noduleUnit: "cm" });
    });

    ["none", "bilateral", "unclear"].forEach(function (ct) {
      cases.push({ name: "ct_" + ct + "_otherwise_positive", potassium: 3.5, pac: 200, pacUnit: "pg/mL", renin: 5, ct: ct, nodule: 99, noduleUnit: "mm" });
    });

    [
      ["K_low_block", { potassium: 0.9, pac: 200, renin: 5, ct: "single", nodule: 10 }],
      ["K_high_block", { potassium: 10.1, pac: 200, renin: 5, ct: "single", nodule: 10 }],
      ["PAC_negative_block", { potassium: 3.5, pac: -1, renin: 5, ct: "single", nodule: 10 }],
      ["PAC_high_block", { potassium: 3.5, pac: 5001, renin: 5, ct: "single", nodule: 10 }],
      ["PRC_negative_block", { potassium: 3.5, pac: 200, renin: -0.1, ct: "single", nodule: 10 }],
      ["PRC_high_block", { potassium: 3.5, pac: 200, renin: 200.1, ct: "single", nodule: 10 }],
      ["Nodule_high_block", { potassium: 3.5, pac: 200, renin: 5, ct: "single", nodule: 100.1 }],
      ["PAC_soft_warning", { potassium: 3.5, pac: 1001, renin: 5, ct: "single", nodule: 10 }],
      ["PRC_soft_warning", { potassium: 3.5, pac: 200, renin: 0.52, ct: "single", nodule: 10 }],
      ["Nodule_soft_warning", { potassium: 3.5, pac: 200, renin: 5, ct: "single", nodule: 50.1 }],
      ["scope_not_confirmed_pa", { potassium: 3.5, pac: 200, renin: 5, ct: "single", nodule: 10, confirmedPa: false }],
      ["scope_pra", { potassium: 3.5, pac: 200, renin: 5, ct: "single", nodule: 10, reninMethod: "pra" }],
      ["scope_lcms", { potassium: 3.5, pac: 200, renin: 5, ct: "single", nodule: 10, pacMethod: "lcms" }]
    ].forEach(function (row) {
      row[1].name = row[0];
      row[1].pacUnit = row[1].pacUnit || "pg/mL";
      row[1].noduleUnit = row[1].noduleUnit || "mm";
      cases.push(row[1]);
    });

    var state = seed || 20260913;
    function rand() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    }
    var cts = ["single", "none", "bilateral", "unclear"];
    var pacUnits = ["pg/mL", "pmol/L"];
    var noduleUnits = ["mm", "cm"];
    for (var i = 0; i < (count || 5000); i++) {
      var pacUnit = pacUnits[Math.floor(rand() * pacUnits.length)];
      var noduleUnit = noduleUnits[Math.floor(rand() * noduleUnits.length)];
      var pacPg = rand() * 1200;
      var noduleMm = rand() * 60;
      cases.push({
        name: "random_" + i,
        potassium: round(1.5 + rand() * 5.5, 2),
        pac: pacUnit === "pmol/L" ? round(pacPg * PAC_PMOL_PER_PG_ML, 1) : round(pacPg, 1),
        pacUnit: pacUnit,
        renin: round(rand() * 30, 2),
        ct: cts[Math.floor(rand() * cts.length)],
        nodule: noduleUnit === "cm" ? round(noduleMm / 10, 2) : round(noduleMm, 1),
        noduleUnit: noduleUnit
      });
    }
    return cases;
  }

  return {
    PAC_PMOL_PER_PG_ML: PAC_PMOL_PER_PG_ML,
    THRESHOLDS: THRESHOLDS,
    HARD_LIMITS: HARD_LIMITS,
    CT_LABELS: CT_LABELS,
    normalizePac: normalizePac,
    normalizeNodule: normalizeNodule,
    evaluate: evaluate,
    makeAuditCases: makeAuditCases
  };
});
