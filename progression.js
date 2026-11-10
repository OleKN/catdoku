/* Saved progression and pace-based difficulty, shared by the UI and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MewdokuProgression = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var sizes = [5, 6, 7, 8, 9, 10, 12, 16, 20, 25];
  var tiers = ['Gentle', 'Steady', 'Tricky', 'Expert'];
  var xpPerLevel = 100;

  function valid(profile) {
    return !!profile && Number.isSafeInteger(profile.xp) && profile.xp >= 0 &&
      profile.xp <= Number.MAX_SAFE_INTEGER - 40 &&
      Number.isInteger(profile.tier) && profile.tier >= 0 && profile.tier < tiers.length &&
      sizes.indexOf(profile.size) >= 0;
  }

  function level(xp) { return 1 + Math.floor(xp / xpPerLevel); }

  function targetTime(size, tier) {
    return size * size * 2000 * [1, 1.25, 1.6, 2][tier];
  }

  function complete(profile, elapsed) {
    if (!valid(profile) || !Number.isFinite(elapsed) || elapsed < 0) {
      throw new Error('Invalid puzzle completion');
    }
    var target = targetTime(profile.size, profile.tier);
    var pace = elapsed <= target * .75 ? 'fast' : elapsed >= target * 1.5 ? 'slow' : 'steady';
    var earned = pace === 'fast' ? 40 : pace === 'slow' ? 20 : 25;
    var tier = profile.tier;
    var index = sizes.indexOf(profile.size);
    if (pace === 'fast') {
      if (tier < tiers.length - 1) tier++;
      else if (index < sizes.length - 1) { index++; tier = 1; }
    } else if (pace === 'slow') {
      if (tier > 0) tier--;
      else if (index > 0) { index--; tier = 1; }
    }
    var next = { xp: profile.xp + earned, tier: tier, size: sizes[index] };
    return {
      profile: next,
      earned: earned,
      pace: pace,
      leveledUp: level(next.xp) > level(profile.xp)
    };
  }

  return {
    sizes: sizes,
    tiers: tiers,
    xpPerLevel: xpPerLevel,
    valid: valid,
    level: level,
    targetTime: targetTime,
    complete: complete
  };
});
