export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export function getSeasonLabel(season) {
  return ({
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬'
  })[season] || season;
}
