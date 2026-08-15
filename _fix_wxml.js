const fs = require('fs');
const p = 'E:/AAAAA/pokemmo-spawn-query/miniprogram/pages/index/index.wxml';
let t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const old = `      <view class="detail-list">
        <view wx:for="{{detailRecords}}" wx:key="key" class="detail-row">
          <text>{{item.region}} · {{item.location}}</text>
          <text>{{item.season}} · {{item.hordeText}} · Lv.{{item.level}}</text>
        </view>
      </view>`;

const nw = `      <view class="detail-list">
        <view wx:for="{{detailRecords}}" wx:key="key" class="detail-row">
          <view class="detail-row-top">
            <text class="detail-loc">{{item.region}} · {{item.location}}</text>
            <text class="detail-meta">{{item.season}} · {{item.hordeText}} · Lv.{{item.level}}</text>
          </view>
          <view class="detail-times">
            <text wx:for="{{item.timeItems}}" wx:key="key" wx:for-item="ti" class="time-chip {{ti.enabled ? 'time-on' : 'time-off'}}" data-idx="{{index}}" data-time="{{ti.key}}" catchtap="openDetailLocation">{{ti.text}}</text>
          </view>
        </view>
      </view>`;

t = t.replace(old, nw);
fs.writeFileSync(p, t.replace(/\n/g, '\r\n'), 'utf8');
console.log('done:', t.includes('openDetailLocation'));
