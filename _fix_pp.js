const fs = require('fs');
const p = 'E:/AAAAA/pokemmo-spawn-query/miniprogram/pages/index/index.js';
let t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const old = "function purePoint(record, time) { if (!horde(record)) return false; if (time) { const fields = { morning: [F.MORNING, F.R_MORNING], day: [F.DAY, F.R_DAY], night: [F.NIGHT, F.R_NIGHT] }[time]; return fields && record[fields[0]] && five(record[fields[1]]); } return (record[F.MORNING] && five(record[F.R_MORNING])) || (record[F.DAY] && five(record[F.R_DAY])) || (record[F.NIGHT] && five(record[F.R_NIGHT])); }";

const nw = "function purePoint(record, time) { if (!horde(record)) return false; if (time === 'morning') return record[F.MORNING] && five(record[F.R_MORNING]); if (time === 'day') return record[F.DAY] && five(record[F.R_DAY]); if (time === 'night') return record[F.NIGHT] && five(record[F.R_NIGHT]); return (record[F.MORNING] && five(record[F.R_MORNING])) || (record[F.DAY] && five(record[F.R_DAY])) || (record[F.NIGHT] && five(record[F.R_NIGHT])); }";

t = t.replace(old, nw);
fs.writeFileSync(p, t.replace(/\n/g, '\r\n'), 'utf8');
console.log('done:', t.includes("time === 'morning'"));
