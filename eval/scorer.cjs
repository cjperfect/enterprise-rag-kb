/** 检索层只评估证据命中；是否幻觉/正确拒答必须检查最终回答。 */
function findHitRank(item, results) {
  return results.findIndex((r) => {
    if (item.expect_doc && !r.documentName?.includes(item.expect_doc)) return false;
    if (item.expect_section) return r.content.includes(item.expect_section);
    if (item.expect_keywords?.length) return item.expect_keywords.some((kw) => r.content.includes(kw));
    return Boolean(item.expect_doc);
  });
}

function scoreItem(item, results, ks) {
  const adversarial = item.type === "adversarial";
  const rank = findHitRank(item, results);
  const out = {
    id: item.id,
    query: item.query,
    type: item.type ?? "text",
    // 陷阱题没有正证据标注，检索层不能判定通过/失败。
    hit: adversarial ? null : rank >= 0,
    hitRank: adversarial ? null : rank,
    retrievedCount: results.length,
    mrr: adversarial ? null : rank >= 0 ? 1 / (rank + 1) : 0,
    firstHitDcg: adversarial ? null : rank >= 0 ? 1 / Math.log2(rank + 2) : 0,
  };
  for (const k of ks) out[`hit@${k}`] = adversarial ? null : Number(rank >= 0 && rank < k);
  return out;
}

function aggregate(scored, ks) {
  const normal = scored.filter((s) => s.type !== "adversarial");
  const n = normal.length;
  const mean = (field) => (n ? +(normal.reduce((sum, s) => sum + s[field], 0) / n).toFixed(3) : null);
  const summary = { questions: n, hitCount: normal.filter((s) => s.hit).length, mrr: mean("mrr"), firstHitDcg: mean("firstHitDcg") };
  for (const k of ks) summary[`hit@${k}`] = mean(`hit@${k}`);
  return summary;
}

module.exports = { findHitRank, scoreItem, aggregate };
