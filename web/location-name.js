window.LocationName = (function () {
  var originalLocations = new WeakMap();

  var DIRECTIONS = {
    East: '东侧',
    West: '西侧',
    North: '北侧',
    South: '南侧',
  };

  var SUFFIXES = {
    '???': '未知区域',
    'Back Room': '后室',
    Cave: '洞窟',
    Center: '中央区域',
    'Center Area': '中央区',
    'Cold Room': '寒冷房间',
    Depths: '深处',
    'Dining Room': '餐厅',
    East: '东侧',
    'East Area': '东区',
    Entrance: '入口',
    Entryway: '入口通道',
    Forest: '森林',
    Gate: '关卡',
    'Hidden Room': '隐藏房间',
    Inner: '内部',
    Interior: '内部',
    'Lower Interior': '下层内部',
    'Lower Mountainside': '低山腰',
    Mountainside: '山腰',
    North: '北侧',
    'North Area': '北区',
    'North Mountainside': '北侧山腰',
    'Northeast Area': '东北区',
    'Northern Room': '北侧房间',
    'Northwest Area': '西北区',
    'Northwest Room': '西北侧房间',
    Outer: '外围',
    Outside: '外部',
    Rooftop: '屋顶',
    South: '南侧',
    'South Area': '南区',
    'South Mountainside': '南侧山腰',
    'Southeast Area': '东南区',
    'Southern Room': '南侧房间',
    'Southwest Area': '西南区',
    Summit: '山顶',
    Tunnel: '隧道',
    'Upper Interior': '上层内部',
    'Upper Mountainside': '高山腰',
    West: '西侧',
    'West Area': '西区',
  };

  function translateSuffix(suffix) {
    var floor = suffix.match(/^(\d+)F(?: (East|West|North|South))?$/);
    if (floor) {
      return floor[1] + '楼' + (floor[2] ? DIRECTIONS[floor[2]] : '');
    }

    var basement = suffix.match(/^B(\d+)F(?: (East|West|North|South))?$/);
    if (basement) {
      return '地下' + basement[1] + '楼' + (basement[2] ? DIRECTIONS[basement[2]] : '');
    }

    var towerFloor = suffix.match(/^Tower (\d+)F$/);
    if (towerFloor) return '塔' + towerFloor[1] + '楼';

    var numberedArea = suffix.match(/^Area (\d+)$/);
    if (numberedArea) return numberedArea[1] + '区';

    return SUFFIXES[suffix] || suffix;
  }

  function translate(locationName) {
    return String(locationName == null ? '' : locationName).replace(
      /\) \(([^()]*)\)$/,
      function (match, suffix) {
        var translated = translateSuffix(suffix);
        return translated === suffix ? match : ') (' + translated + ')';
      }
    );
  }

  function translateRecords(records, locationField) {
    return applyLanguage(records, locationField, 'zh');
  }

  function applyLanguage(records, locationField, language) {
    records.forEach(function (record) {
      if (!originalLocations.has(record)) {
        originalLocations.set(record, record[locationField]);
      }
      var original = originalLocations.get(record);
      record[locationField] = language === 'en' ? original : translate(original);
    });
    return records;
  }

  return {
    applyLanguage: applyLanguage,
    translate: translate,
    translateRecords: translateRecords,
    translateSuffix: translateSuffix,
  };
})();
