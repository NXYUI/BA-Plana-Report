# BA Plana Report 학생 데이터

이 브랜치는 GitHub Actions(`.github/workflows/sync-students.yml`)가 매일 자동으로 갱신합니다. 직접 고치지 마세요.

- `students.json`: [SchaleDB](https://schaledb.com)의 한국어 학생 데이터에서 BA Plana Report 앱이 쓰는 필드만 남긴 것 (Id, Name, SquadType, IsReleased, DefaultOrder와 프로필 속성: 공격·방어 타입, 무기, 사거리, 엄폐, 포지션, 역할, 학교, 지형 적성)
- `skills.json`: 학생별 스킬(이름, 설명, 레벨별 수치, 코스트, 아이콘 이름)과 효과 이름 사전(SchaleDB 한국어 BuffName). 앱이 학생 프로필을 처음 열 때 받는다
- `bond.json`: 학생 프로필(이름, 학년, 생일, 취미, 소개, 학교·동아리)과 대사 글자(로비·모집·승리·편성·인연 랭크). 앱의 당번이 쓴다. 음성은 넣지 않는다
- `icons/student/<Id>.webp`, `icons/skill/<아이콘 이름>.webp`: SchaleDB의 학생·스킬 아이콘
- `portraits/<Id>.webp`: SchaleDB의 학생 전신 일러스트 (당번·학생 뽑기)
- `meta.json`: 출처, 학생 수, 각 파일의 SHA-256, 아이콘 수

데이터와 그림의 출처는 SchaleDB입니다. 앱은 이 브랜치에서 먼저 받고, 받을 수 없으면 SchaleDB에서 직접 받습니다.
