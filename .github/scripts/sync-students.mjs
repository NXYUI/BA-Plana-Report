// SchaleDB 학생 데이터(한국어)를 받아 BA Combat 앱이 쓰는 필드만 남겨 저장한다.
// - students.json: 명부(이름, 구분, 출시 여부, 순서)와 프로필 속성(공격·방어 타입, 무기, 사거리, 엄폐, 포지션, 역할, 학교, 지형 적성)
// - skills.json: 스킬(EX·기본·강화·서브와 애용품·고유무기 강화)과 효과 이름 사전. 앱이 학생 프로필을 처음 열 때 받는다
// 형식이 이상하면 실패해서(종료 코드 1) data 브랜치의 기존 데이터를 덮지 않는다.
// 사용: node .github/scripts/sync-students.mjs <출력 폴더>

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE = 'https://schaledb.com/data/kr/students.min.json'
const LOCALIZATION = 'https://schaledb.com/data/kr/localization.min.json'
const MIN_STUDENTS = 100
const out = process.argv[2] ?? 'out'

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'BA-Combat student data sync (+https://github.com/NXYUI/BA-Combat)' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`SchaleDB 응답 오류: HTTP ${res.status} (${url})`)
  return res.json()
}
const [raw, localization] = await Promise.all([get(SOURCE), get(LOCALIZATION)])
const list = Array.isArray(raw) ? raw : Object.values(raw)

// 프로필 속성: 있는 것만 옮긴다 (앱이 값을 다시 검사한다)
const ATTRS = ['BulletType', 'ArmorType', 'WeaponType', 'Cover', 'Range', 'Position', 'TacticRole', 'School', 'StreetBattleAdaptation', 'OutdoorBattleAdaptation', 'IndoorBattleAdaptation']
const pickAttrs = (s) => Object.fromEntries(ATTRS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))
// 스킬: 앱이 쓰는 종류·필드만
const SKILL_KINDS = ['Ex', 'Public', 'Passive', 'ExtraPassive', 'WeaponPassive', 'GearPublic']
const pickSkill = (v) =>
  v && typeof v === 'object' ? Object.fromEntries(['Name', 'Desc', 'Parameters', 'Cost'].filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) : undefined
const pickSkills = (s) =>
  Object.fromEntries(SKILL_KINDS.filter((k) => s?.Skills?.[k]).map((k) => [k, pickSkill(s.Skills[k])]))

const problems = []
const students = []
const skillList = []
for (const s of list) {
  const ok =
    Number.isInteger(s?.Id) &&
    typeof s?.Name === 'string' &&
    s.Name.trim() !== '' &&
    (s?.SquadType === 'Main' || s?.SquadType === 'Support') &&
    Array.isArray(s?.IsReleased) &&
    s.IsReleased.length >= 2 &&
    s.IsReleased.every((v) => typeof v === 'boolean')
  if (!ok) {
    problems.push(s?.Id ?? '(Id 없음)')
    continue
  }
  students.push({
    Id: s.Id,
    Name: s.Name,
    SquadType: s.SquadType,
    IsReleased: s.IsReleased,
    DefaultOrder: Number.isFinite(s.DefaultOrder) ? s.DefaultOrder : s.Id,
    ...pickAttrs(s),
  })
  const skills = pickSkills(s)
  if (Object.keys(skills).length) skillList.push({ Id: s.Id, Skills: skills })
}

if (students.length < MIN_STUDENTS) throw new Error(`학생이 ${students.length}명뿐이에요. SchaleDB 형식이 바뀌었을 수 있어요.`)
// 일부만 이상하면 그 항목만 빼고 진행하되, 많이 이상하면 형식이 바뀐 것으로 보고 멈춘다
if (problems.length > list.length * 0.05) throw new Error(`형식이 맞지 않는 항목이 ${problems.length}개예요: ${problems.slice(0, 10).join(', ')}`)
if (problems.length) console.warn(`형식이 맞지 않아 뺀 항목: ${problems.join(', ')}`)

if (skillList.length < MIN_STUDENTS) throw new Error(`스킬이 있는 학생이 ${skillList.length}명뿐이에요. SchaleDB 형식이 바뀌었을 수 있어요.`)
const terms = localization?.BuffName
if (!terms || typeof terms !== 'object' || Object.keys(terms).length < 50) throw new Error('효과 이름 사전(BuffName)이 없거나 너무 작아요.')

students.sort((a, b) => a.Id - b.Id)
skillList.sort((a, b) => a.Id - b.Id)
const body = JSON.stringify(students) + '\n'
const sha256 = createHash('sha256').update(body).digest('hex')
const skillsBody = JSON.stringify({ schema: 1, terms, students: skillList }) + '\n'
const skillsSha256 = createHash('sha256').update(skillsBody).digest('hex')

await mkdir(out, { recursive: true })
await writeFile(join(out, 'students.json'), body)
await writeFile(join(out, 'skills.json'), skillsBody)
// 날짜를 넣지 않는다: 내용이 같으면 파일도 같아서 커밋이 생기지 않는다 (갱신 시각은 커밋 기록으로 본다)
await writeFile(
  join(out, 'meta.json'),
  JSON.stringify({ schema: 2, source: SOURCE, count: students.length, sha256, skills: { source: [SOURCE, LOCALIZATION], count: skillList.length, sha256: skillsSha256 } }, null, 2) + '\n',
)
await writeFile(
  join(out, 'README.md'),
  `# BA Combat 학생 데이터

이 브랜치는 GitHub Actions(\`.github/workflows/sync-students.yml\`)가 매일 자동으로 갱신합니다. 직접 고치지 마세요.

- \`students.json\`: [SchaleDB](https://schaledb.com)의 한국어 학생 데이터에서 BA Combat 앱이 쓰는 필드만 남긴 것 (Id, Name, SquadType, IsReleased, DefaultOrder와 프로필 속성: 공격·방어 타입, 무기, 사거리, 엄폐, 포지션, 역할, 학교, 지형 적성)
- \`skills.json\`: 학생별 스킬(이름, 설명, 레벨별 수치, 코스트)과 효과 이름 사전(SchaleDB 한국어 BuffName). 앱이 학생 프로필을 처음 열 때 받는다
- \`meta.json\`: 출처, 학생 수, 각 파일의 SHA-256

데이터의 출처는 SchaleDB입니다. 앱은 이 파일을 먼저 받고, 받을 수 없으면 SchaleDB에서 직접 받습니다. 학생 아이콘은 이 브랜치에 두지 않으며 앱이 SchaleDB에서 받습니다.
`,
)
console.log(`학생 ${students.length}명, sha256 ${sha256.slice(0, 12)}… / 스킬 ${skillList.length}명, sha256 ${skillsSha256.slice(0, 12)}…`)
