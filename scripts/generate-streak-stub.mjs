#!/usr/bin/env node
// GitHub GraphQL로 실제 기여 통계를 가져와 assets/streak-stub.svg를 정적으로 생성한다.
// streak-stats.demolab.com 같은 실시간 렌더링 위젯은 GitHub의 camo 프록시 타임아웃(504)에
// 자주 걸려서, 같은 데이터를 직접 계산해 저장소에 정적 이미지로 커밋해두는 방식으로 대체한다.
// GitHub Actions에서는 자동 제공되는 GITHUB_TOKEN을, 로컬에서는 `gh auth token`을 사용한다.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import path from 'node:path';

const GITHUB_USERNAME = 'doHoaSen';
const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../assets/streak-stub.svg'
);

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('GitHub 토큰을 찾을 수 없습니다 (GITHUB_TOKEN 환경변수 또는 gh auth login 필요).');
  }
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

function computeStreaks(days) {
  let longest = 0;
  let run = 0;
  days.forEach((d) => {
    if (d.contributionCount > 0) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  });
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else break;
  }
  return { current, longest };
}

function escapeXml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderSvg({ today, total, current, longest, asOf }) {
  const W = 495;
  const H = 150;
  const ink = '#1a1a1a';
  const inkSoft = '#666666';
  const line = '#d9d9d9';
  const paper = '#ffffff';

  const col = (cx, label, value, suffix = '') => `
    <text x="${cx}" y="60" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="8.5" letter-spacing="1" fill="${inkSoft}" font-weight="600">${escapeXml(label)}</text>
    <text x="${cx}" y="93" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="26" font-weight="700" fill="${ink}">${value}${suffix ? `<tspan font-size="11" font-weight="500" fill="${inkSoft}"> ${escapeXml(suffix)}</tspan>` : ''}</text>`;

  const zigzag = (() => {
    const teeth = 24;
    const step = W / teeth;
    let d = `M0,${H - 6}`;
    for (let i = 0; i <= teeth; i++) {
      const x = i * step;
      d += ` L${x.toFixed(1)},${i % 2 === 0 ? H : H - 6}`;
    }
    d += ` L${W},${H - 20} L0,${H - 20} Z`;
    return d;
  })();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="1" y="1" width="${W - 2}" height="${H - 22}" fill="${paper}" stroke="${ink}" stroke-width="1.5"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 32}" fill="none" stroke="${line}" stroke-width="1"/>
  <text x="${W / 2}" y="27" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="11" letter-spacing="3" fill="${inkSoft}" font-weight="600">CONTRIBUTION SLIP</text>
  <line x1="20" y1="39" x2="${W - 20}" y2="39" stroke="${line}" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="${W / 4}" y1="48" x2="${W / 4}" y2="100" stroke="${line}" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="${W / 2}" y1="48" x2="${W / 2}" y2="100" stroke="${line}" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="${(W / 4) * 3}" y1="48" x2="${(W / 4) * 3}" y2="100" stroke="${line}" stroke-width="1" stroke-dasharray="3,3"/>
  ${col(W / 8, 'TODAY', today)}
  ${col((W / 8) * 3, 'TOTAL (1Y)', total)}
  ${col((W / 8) * 5, 'CURRENT STREAK', current, current === 1 ? 'day' : 'days')}
  ${col((W / 8) * 7, 'LONGEST STREAK', longest, longest === 1 ? 'day' : 'days')}
  <line x1="20" y1="108" x2="${W - 20}" y2="108" stroke="${line}" stroke-width="1" stroke-dasharray="3,3"/>
  <text x="${W - 20}" y="121" text-anchor="end" font-family="Georgia,'Times New Roman',serif" font-style="italic" font-size="9.5" fill="${inkSoft}">as of ${escapeXml(asOf)}</text>
  <path d="${zigzag}" fill="${paper}" stroke="${ink}" stroke-width="1"/>
</svg>`;
}

async function main() {
  const token = getToken();
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: GITHUB_USERNAME } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL 요청 실패: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL 에러: ${JSON.stringify(json.errors)}`);
  }

  const cc = json.data.user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const { current, longest } = computeStreaks(days);
  const total = cc.contributionCalendar.totalContributions;
  const today = days[days.length - 1]?.contributionCount ?? 0;

  const asOf = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const svg = renderSvg({ today, total, current, longest, asOf });

  await writeFile(OUT_PATH, svg, 'utf8');
  console.log('streak-stub.svg 갱신 완료', { today, total, current, longest, asOf });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
