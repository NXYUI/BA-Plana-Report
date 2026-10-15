// SchaleDB 학생 데이터(한국어)를 받아 BA Combat 앱이 쓰는 필드만 남겨 저장한다.
// - students.json: 명부(이름, 구분, 출시 여부, 순서)와 프로필 속성(공격·방어 타입, 무기, 사거리, 엄폐, 포지션, 역할, 학교, 지형 적성)
// - skills.json: 스킬(EX·기본·강화·서브와 애용품·고유무기 강화, 아이콘 이름)과 효과 이름 사전. 앱이 학생 프로필을 처음 열 때 받는다
// - icons/student/<Id>.webp, icons/skill/<Icon>.webp: 학생·스킬 아이콘. 앱이 SchaleDB 대신 여기서 먼저 받는다.
//   이미 있는 그림은 다시 받지 않는다(--refresh-icons면 모두 다시 받는다). 그림을 못 받아도 데이터 갱신은 멈추지 않는다
// 형식이 이상하면 실패해서(종료 코드 1) data 브랜치의 기존 데이터를 덮지 않는다.
// 사용: node .github/scripts/sync-students.mjs <출력 폴더(data 브랜치 작업 트리)> [--refresh-icons]

import { createHash } from 'node:crypto'
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE = 'https://schaledb.com/data/kr/students.min.json'
const LOCALIZATION = 'https://schaledb.com/data/kr/localization.min.json'
const MIN_STUDENTS = 100
const out = process.argv[2] ?? 'out'
const refreshIcons = process.argv.includes('--refresh-icons')
const HEADERS = { 'user-agent': 'BA-Combat student data sync (+https://github.com/NXYUI/BA-Combat)' }

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) })
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
  v && typeof v === 'object' ? Object.fromEntries(['Name', 'Desc', 'Parameters', 'Cost', 'Icon'].filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) : undefined
// 아이콘 이름은 파일 이름이 되므로 앱과 같은 글자만 받는다 (src/shared/skills.ts SKILL_ICON_NAME)
const ICON_NAME = /^[A-Za-z0-9_]{1,80}$/
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

// 아이콘: 없는 것만 받는다 (SchaleDB에 보내는 요청을 줄이려고). 받은 것이 WebP가 아니면 버린다
const isWebp = (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
const exists = (f) => access(f).then(() => true, () => false)
const skillIcons = [
  ...new Set(skillList.flatMap((s) => Object.values(s.Skills).map((k) => k?.Icon)).filter((n) => typeof n === 'string' && ICON_NAME.test(n))),
]
const jobs = [
  ...students.map((s) => ({ url: `https://schaledb.com/images/student/icon/${s.Id}.webp`, dir: 'icons/student', file: `${s.Id}.webp` })),
  ...skillIcons.map((n) => ({ url: `https://schaledb.com/images/skill/${n}.webp`, dir: 'icons/skill', file: `${n}.webp` })),
]
const todo = []
for (const j of jobs) if (refreshIcons || !(await exists(join(out, j.dir, j.file)))) todo.push(j)
const iconFailures = []
let fetched = 0
async function iconWorker() {
  for (let j = todo.shift(); j; j = todo.shift()) {
    try {
      const res = await fetch(j.url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > 512 * 1024 || !isWebp(bytes)) throw new Error('WebP가 아님')
      await mkdir(join(out, j.dir), { recursive: true })
      await writeFile(join(out, j.dir, j.file), bytes)
      fetched++
    } catch (e) {
      iconFailures.push(`${j.dir}/${j.file} (${e.message})`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, iconWorker))
if (iconFailures.length) console.warn(`받지 못한 아이콘 ${iconFailures.length}개: ${iconFailures.slice(0, 20).join(', ')}`)
const countDir = async (d) => (await readdir(join(out, d)).catch(() => [])).filter((f) => f.endsWith('.webp')).length

// 날짜를 넣지 않는다: 내용이 같으면 파일도 같아서 커밋이 생기지 않는다 (갱신 시각은 커밋 기록으로 본다)
await writeFile(
  join(out, 'meta.json'),
  JSON.stringify(
    {
      schema: 2,
      source: SOURCE,
      count: students.length,
      sha256,
      skills: { source: [SOURCE, LOCALIZATION], count: skillList.length, sha256: skillsSha256 },
      icons: { student: await countDir('icons/student'), skill: await countDir('icons/skill') },
    },
    null,
    2,
  ) + '\n',
)
await writeFile(
  join(out, 'README.md'),
  `# BA Combat 학생 데이터

이 브랜치는 GitHub Actions(\`.github/workflows/sync-students.yml\`)가 매일 자동으로 갱신합니다. 직접 고치지 마세요.

- \`students.json\`: [SchaleDB](https://schaledb.com)의 한국어 학생 데이터에서 BA Combat 앱이 쓰는 필드만 남긴 것 (Id, Name, SquadType, IsReleased, DefaultOrder와 프로필 속성: 공격·방어 타입, 무기, 사거리, 엄폐, 포지션, 역할, 학교, 지형 적성)
- \`skills.json\`: 학생별 스킬(이름, 설명, 레벨별 수치, 코스트, 아이콘 이름)과 효과 이름 사전(SchaleDB 한국어 BuffName). 앱이 학생 프로필을 처음 열 때 받는다
- \`icons/student/<Id>.webp\`, \`icons/skill/<아이콘 이름>.webp\`: SchaleDB의 학생·스킬 아이콘
- \`meta.json\`: 출처, 학생 수, 각 파일의 SHA-256, 아이콘 수

데이터와 그림의 출처는 SchaleDB입니다. 앱은 이 브랜치에서 먼저 받고, 받을 수 없으면 SchaleDB에서 직접 받습니다.
`,
)
console.log(`학생 ${students.length}명, sha256 ${sha256.slice(0, 12)}… / 스킬 ${skillList.length}명, sha256 ${skillsSha256.slice(0, 12)}…`)
console.log(`아이콘 ${fetched}개를 새로 받음 (모두 ${jobs.length}개, 실패 ${iconFailures.length}개)`)
