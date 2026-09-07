# ACC — การทำงานและเปิดใช้ deployment มาตรฐาน

## ขอบเขตและสถานะการติดตั้ง

Repository: `kawinprogrammer04/acc-kawin` (URL เดิมของ owner `kawinprogrammer05` redirect มาที่นี่)
Integration/default: `main`; deploy target: `production` **ตัวพิมพ์เล็ก**
Production ใช้ `docker-compose.plesk.yml`, FastAPI/React/PostgreSQL และ Plesk reverse proxy

ไฟล์ใน PR นี้เป็นชุดติดตั้ง ยังไม่หมายความว่า GitHub settings หรือ server เปลี่ยนแล้ว
การ merge เข้า `main` ไม่ deploy; การ merge Release PR เข้า `production` จะ deploy จริง
ผู้ดูแลต้องติดตั้งสคริปต์บน server และ fingerprint ก่อน Release ครั้งแรก มิฉะนั้น workflow
ใหม่จะหยุดก่อนเรียก sudo เพราะ checksum/config ไม่ตรง ระบบเดิมที่กำลังรันจะยังไม่ถูกแตะ

## วิธีทำงานประจำวัน

1. สร้าง Issue ตาม `.claude/CLAUDE.md`; เรื่องใหม่แตก `feature/<issue>-<slug>` หรือ
   `fix/<issue>-<slug>` จาก `main` ที่อัปเดตแล้ว ห้ามใช้ branch ประจำบุคคลสำหรับงานใหม่
2. Commit message เป็นภาษาไทย; เปิด PR ด้วย `--base main` เสมอและอ้าง Issue
3. รัน checks และตรวจหน้าที่เกี่ยวข้องด้วยมือก่อน merge; `main` ต้องพร้อม deploy เสมอ
4. เปิด Release PR จาก `main` ไป `production`, ระบุ Issue ที่รวมใน release และหลักฐานตรวจ
5. Release ใช้ **merge commit** (`--merge`) เพื่อรักษาประวัติของสอง branch ไม่ squash/rebase
6. Back-merge `production` เข้า `main` ผ่าน PR หลัง release เพื่อให้ strict checks ของ release
   ถัดไปเทียบกับฐานล่าสุดได้โดยไม่ต้องมี merge commit แฝงระหว่างเปิด release

```bash
# รันใน checkout ที่สะอาด; ไม่รัน switch/pull ทับงาน Whan ที่ยังไม่ commit
# เปลี่ยน 123 และ slug เป็นเลข Issue/ชื่อของงานจริง

git fetch origin
git switch -c feature/123-example origin/main
# แก้ไข ตรวจสอบ แล้ว stage เฉพาะไฟล์ของงาน
# git commit -m 'เพิ่มรายละเอียดงานภาษาไทย (#123)'
git push -u origin feature/123-example
gh pr create --repo kawinprogrammer04/acc-kawin --base main --head feature/123-example

# เมื่อ main พร้อม release; body ต้องระบุ Issue และวิธีตรวจ
gh pr create --repo kawinprogrammer04/acc-kawin --base production --head main \
  --title 'ปล่อยเวอร์ชัน: รายละเอียดงาน (#123)'
# หลัง review และ checks ผ่าน ใช้เลข Release PR จริงแทน RELEASE_PR
gh pr merge RELEASE_PR --repo kawinprogrammer04/acc-kawin --merge

# หลัง deploy ผ่าน; อ้าง Issue เดิมใน body ของ back-merge PR ด้วย
gh pr create --repo kawinprogrammer04/acc-kawin --base main --head production \
  --title 'นำประวัติ production กลับเข้า main (#123)'
```

การระบุ `--base` เป็นวินัย CLI; GitHub ตรวจได้เฉพาะ base/head ของ PR ที่เกิดขึ้นจริง
ไม่สามารถตรวจย้อนหลังได้ว่าผู้ใช้พิมพ์ flag นี้หรือปล่อย CLI เดา

งานบน `Whan` ต้องตรวจ diff และแก้ conflict ก่อนนำเข้า main ผ่าน feature/fix PR
ห้าม cherry-pick เพื่อเลือกงานเข้า production ห้าม push/force push ตรงเข้า main/production
งานที่ยังไม่ต้องการ ship ให้ใช้ feature flag หรือ revert ผ่าน PR บน main ก่อน Release

## Hotfix และ rollback

- ปกติ: `fix/*` → PR → `main` → Release PR ทันที
- ฉุกเฉิน: แตก `fix/<issue>-...` จาก `origin/production`, เปิด PR ด้วย `--base production`
  และ label `emergency-hotfix` หรือ `emergency-rollback`; ต้องผ่าน review และ checks เช่นเดิม
- Label เป็นการระบุกรณีฉุกเฉิน ไม่ใช่การอนุมัติ ต้องมีผู้ review คนอื่นตาม branch protection
- Rollback ใช้ `git revert` ใน fix branch แล้วเปิด PR เข้า production ห้าม direct push
  ถ้า revert merge commit ต้องเลือก parent ให้ถูก เช่น `git revert -m 1 <release-merge-sha>`
- หลัง emergency deploy ต้อง back-merge production → main ผ่าน PR **ทันที** และแก้ conflict
  ให้คงผลแก้/ย้อนกลับ อย่าทิ้ง drift
- Revert โค้ดไม่ย้อนฐานข้อมูล: ตรวจ compatibility ของ Alembic และข้อมูลก่อน rollback
  ห้ามอัตโนมัติ `alembic downgrade`, restore DB หรือ `docker compose down -v`
- หาก rollback เปลี่ยนไฟล์ `scripts/deploy/deploy-acc-kawin.sh` ต้องติดตั้งรุ่นที่ตรวจแล้วให้ตรง
  checksum ก่อนปล่อย release เช่นกัน ควรแยกการย้อน app ออกจากการย้อนระบบ deploy

## สิ่งที่ CI บังคับ

- `backend-lint`: compile Python ทุกไฟล์ backend ที่ tracked; ไม่ใช้ diff ที่อาจว่างแล้วข้าม
- `frontend-build`: `npm ci` และ `npm run build` (TypeScript + Vite)
- `check-migrations`: Alembic ต้องมี head เดียว บนทั้ง PR และ push ของสอง branch
- `deployment-tests`: ทดสอบกฎ PR/ไฟล์ และเส้นทางสคริปต์ deploy ผ่านบริการจำลอง
- `check-base-branch`: งานเข้า main จาก feature/fix หรือ back-merge production;
  release เข้า production จาก main ใน repo เดียวกัน หรือ emergency fix ที่มี label
- `check-protected-files`: ตรวจชื่อไฟล์ทั้งก่อนและหลัง rename รวมถึงการลบ
- `check-issue-reference`: อ้าง Issue ใน PR

ตัวตรวจ route/ไฟล์ใช้ `pull_request_target` และอ่านโค้ด/config ของ **base ที่เชื่อถือได้เท่านั้น**
ไม่ checkout/run PR head, ไม่ใช้ secrets, ไม่ยอมผ่านเมื่อ config หาย/ว่าง
PR แรกที่ติดตั้งยังไม่มี trusted policy checks; CI และ review ยังต้องผ่าน
หลัง merge เข้าแต่ละ base แล้วจึงใช้ policy ใหม่กับ PR ถัดไป

deploy ทำเฉพาะ `push` บน `production` และรอ CI ทั้งสี่ job ผ่านก่อนเริ่ม
`workflow_dispatch` ใช้ตรวจซ้ำเท่านั้น ถ้า deploy ล้มเหลวให้ rerun failed jobs ของ push run
แทนการ dispatch deploy เวอร์ชันเก่า (สคริปต์จะปฏิเสธ SHA ที่ไม่ใช่ production tip)

GitHub concurrency และ server `flock` ป้องกัน deploy ซ้อนกัน สคริปต์รับ SHA ผ่าน stdin
ตรวจตรงกับ production tip, backup DB และตรวจ archive, checkout SHA นั้น, build,
ตรวจ tip ซ้ำ แล้ว `up --wait` และตรวจ API; แจ้ง Issue ว่า deployed หลัง deploy สำเร็จเท่านั้น
ไม่มีการใช้ `git clean`, prune volumes, ลบ upload หรือเก็บ credentials ลง repository

## ชุดคำสั่งสำหรับผู้ดูแล: เปิดใช้ครั้งแรก

### 1. Review และ merge PR นี้เข้า main

ตรวจผล CI ของ PR และ review diff ก่อน merge เข้า main โดยยังไม่เปิด Release
ใช้ checkout แยกที่สะอาดสำหรับการติดตั้ง ไม่แก้ checkout Whan ที่มีงานค้าง

```bash
git clone --branch main --single-branch https://github.com/kawinprogrammer04/acc-kawin.git acc-deploy-setup
cd acc-deploy-setup
git rev-parse HEAD
node --test tests/deploy/*.test.cjs
python3 -m unittest discover -s tests/deploy -p 'test_*.py' -v
```

### 2. ติดตั้งสคริปต์บน server ACC ด้วยบัญชีผู้ดูแล

นำ checkout รุ่นที่ review แล้วไปยังเครื่อง server (หรือ clone main ในโฟลเดอร์แยกบน server)
รันคำสั่งต่อไปนี้จาก checkout ชุดติดตั้ง ห้ามใช้คำสั่ง deploy ในขั้นตอนนี้
สำรองสคริปต์และ config เดิมไว้นอก repository ก่อนเปลี่ยน

```bash
# อ่านชื่อ Compose project และตำแหน่งเดิม ไม่สร้าง project/volumes ชุดใหม่
sudo docker inspect acc_backend --format '{{ index .Config.Labels "com.docker.compose.project" }}'
sudo docker inspect acc_backend --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
sudo docker inspect acc_backend --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}'

# เก็บสคริปต์เดิมก่อนติดตั้ง (ไม่ลบหรือทับไฟล์ backup เก่า)
sudo cp -a /usr/local/bin/deploy-acc-kawin.sh "/root/deploy-acc-kawin.sh.before-$(date -u +%Y%m%dT%H%M%SZ)"
# หากเคยติดตั้ง config นี้แล้ว ให้สำรองและแก้ของเดิม แทนการทับด้วยตัวอย่าง
sudo test -e /etc/acc-kawin-deploy.conf || \
  sudo install -o root -g root -m 600 scripts/deploy/acc-kawin-deploy.conf.example /etc/acc-kawin-deploy.conf
sudoedit /etc/acc-kawin-deploy.conf
sudo install -o root -g root -m 755 scripts/deploy/deploy-acc-kawin.sh /usr/local/bin/deploy-acc-kawin.sh
sudo bash -n /usr/local/bin/deploy-acc-kawin.sh
sha256sum scripts/deploy/deploy-acc-kawin.sh /usr/local/bin/deploy-acc-kawin.sh
```

ค่าใน config ต้องเป็นของระบบเดิม: `PROJECT_DIR`, `COMPOSE_PROJECT_NAME`, `HEALTH_URL`
และ `BACKUP_DIR` ซึ่งต้องอยู่นอก checkout มีพื้นที่เพียงพอ และอยู่ภายใต้การดูแลของ root
config ต้องเป็น root:root 0600; checkout และ script ต้องไม่ writable โดย SSH deploy user
ตรวจ `git status` ของ server และจัดการไฟล์ที่ค้างด้วยมือ สคริปต์ไม่ทับ tracked changes
และไม่ลบไฟล์ untracked ให้; `.env`/uploads ที่ ignored ยังคงอยู่

ตรวจสิทธิ์ sudo ของ SSH user ที่บันทึกใน `ACC_DEPLOY_USER` (เดิม workflow ระบุ `gha_deploy_acc`)
ต้องอนุญาตเฉพาะสคริปต์ root-owned แบบไม่มี arguments ไม่ให้ sudo shell ทั่วไป
ตัวอย่างบรรทัด sudoers ที่ผู้ดูแลตรวจด้วย `visudo`:

```sudoers
gha_deploy_acc ALL=(root) NOPASSWD: /usr/local/bin/deploy-acc-kawin.sh ""
```

ต้องมี Bash, Git, Docker Compose v2 ที่รองรับ `up --wait`, `flock`, `curl`, `sha256sum`
และ PostgreSQL tools ภายใน db container

### 3. เพิ่ม SSH host fingerprint

อ่าน fingerprint จาก server ที่เชื่อถือได้โดยตรง ไม่ยอมรับค่า `ssh-keyscan` ที่ยังไม่ตรวจ
แล้วตั้งค่าเป็น environment secret ของ production ผ่านบัญชี Admin:

```bash
# บน server: คัดลอกเฉพาะค่า SHA256:... ของ host key ที่ใช้เชื่อมต่อ
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

ตั้ง environment หลังขั้นตอน 4 แล้วจึงรัน:

```bash
gh secret set ACC_DEPLOY_HOST_FINGERPRINT --repo kawinprogrammer04/acc-kawin --env production
```

คำสั่งจะรับค่าแบบ interactive; ไม่ใส่รหัสผ่าน/private key ในเอกสารหรือ commit
secrets เดิม `ACC_DEPLOY_HOST`, `ACC_DEPLOY_USER`, `ACC_DEPLOY_SSH_KEY` ใช้ต่อได้จาก
repository หรือ production environment (ถ้ามีทั้งสอง ที่ environment จะมีลำดับก่อน)

### 4. ตั้ง GitHub protection และ environment

ใช้บัญชีที่มีสิทธิ์ Admin (`gh auth status` ตรวจได้) จาก checkout ชุดติดตั้งบนเครื่องผู้ดูแล:

```bash
# แสดงแผนอย่างเดียว ยังไม่เขียน settings
python3 scripts/deploy/configure_github.py --bootstrap

# เมื่ออ่านแผนแล้ว: เขียน settings และอ่านกลับตรวจสอบ
python3 scripts/deploy/configure_github.py --bootstrap --apply
```

`--bootstrap` ใช้ครั้งแรกที่ main มี policy ใหม่แล้ว แต่ production ยังไม่มีเท่านั้น
บน main บังคับ checks ครบ; บน production บังคับ CI/review/Issue แต่ยังไม่เพิ่ม
`check-base-branch` และ `check-protected-files` เป็น required เพราะยังรันจาก base เดิมไม่ได้
ไม่ลด required checks เดิม หลัง Release แรกต้องรันแบบปกติทันทีเพื่อบังคับครบทั้งสอง branch:

```bash
# หลัง Release แรกติดตั้ง policy ลง production แล้ว
python3 scripts/deploy/configure_github.py
python3 scripts/deploy/configure_github.py --apply
```

สคริปต์ทำเฉพาะ repo ACC นี้ กำหนด default main, อนุญาต merge commit และไม่ลบ branch
อัตโนมัติ, บังคับ PR+review อย่างน้อย 1 คน, latest-push approval, stale review dismissal,
required checks, conversation resolution, enforce admins และปิด force push/deletion/bypass
คง restrictions/จำนวน reviewer/checks เดิมที่เข้มกว่าไว้ ไม่ลบ rulesets เดิม
หากพบ linear-history/custom environment/branch rules ที่ขัดกันจะหยุดให้ตรวจด้วยมือ
สำรอง settings ก่อนเขียนในไฟล์ temporary ที่สิทธิ์เฉพาะเจ้าของ และแจ้งตำแหน่งเมื่อรัน
ถ้าหยุดกลางทางให้ตรวจ output ว่าขั้นตอนไหนใช้แล้วและ rerun; การเรียกซ้ำไม่สร้าง label/policy ซ้ำ

Environment `production` รับ deployment จาก branch `production` เท่านั้น (ไม่รับ tag)
คง reviewer/wait rules เดิม และสร้าง labels emergency สองชนิดหากยังไม่มี
ห้ามตั้ง `deploy` เป็น required PR check เพราะ job นี้ตั้งใจไม่รันบน PR

การอ่านข้อมูลด้วยบัญชี WRITE ไม่เพียงพอยืนยัน/แก้ branch protection ทั้งหมด
ห้ามรายงานว่าเปิดกฎสำเร็จจนผู้ดูแลรันและตรวจกลับแล้ว

### 5. Release และตรวจจริง

เปิด `main` → `production` Release PR อ้าง Issue #5 และตรวจ checks/review
ก่อน merge ต้องติดตั้ง server script และ fingerprint เรียบร้อยตามข้างบน
หลัง merge ตรวจ Actions ว่า deploy เริ่ม **หลัง** checks ผ่านและ log มี SHA ตรง release,
มี backup verified, containers healthy และ `Deploy OK` แล้วรัน setup ปกติเพื่อเพิ่ม required
trusted checks บน production ให้ครบ จากนั้น back-merge production → main

## การตรวจสอบด้วยมือทุก release

- ใน local/staging: รัน `make test-backend`, build frontend และตรวจหน้าที่ได้รับผลจากงาน
- เปิดหน้า login ของ ACC; เข้าระบบด้วยบัญชีทดสอบที่ได้รับอนุญาต ตรวจ company/tenant และสิทธิ์
- เปิด `/expense-requests/accounting`: filter, KPI, ตาราง, pagination และยอดรวมถูกต้อง
- เปิดคำขอและลำดับอนุมัติ ตรวจว่าผู้ไม่มีสิทธิ์ไม่เห็น/ไม่สามารถอนุมัติรายการนอกขอบเขต
- ตรวจ PDF/export ที่ได้รับผลในข้อมูลทดสอบ; อย่าสร้าง/อนุมัติรายการบัญชีจริงเพียงเพื่อ smoke test
- บน server: `docker compose -f docker-compose.plesk.yml ps` (ใช้ project/env เดิม)
  และ `curl --fail http://127.0.0.1:18080/api/health`; ตรวจ backend logs/migration revision
- API healthy ไม่ใช่หลักฐานว่าหน้า UI/การคำนวณทั้งหมดถูกต้อง ระบุสิ่งที่ยังไม่ได้ตรวจเสมอ

ACC มี `backend/tests` และ `make test-backend` แต่ CI นี้ยังไม่รัน business test suite เต็ม
การทดสอบ deploy ใช้ Git/Docker จำลอง ไม่เข้าถึง production และไม่พิสูจน์ว่า server ติดตั้งแล้ว

## ไฟล์ backup, credential และข้อมูลเก่า

`.gitignore` ช่วยกัน stage โดยไม่ตั้งใจ; required protected-files check ป้องกัน force-add อีกชั้น
ตัวตรวจป้องกัน XLS/XLSX, dump/backup, private key/env และโฟลเดอร์ export ชั่วคราว
รวมการแก้/rename/delete ไฟล์เก่าเพื่อไม่ให้ข้อมูลหาย ห้ามลบไฟล์เก่าเพื่อให้ CI ผ่าน
ACC มี template เดิม `backend/app/templates/tax_invoice_template.xlsx` ที่ต้องเก็บไว้
path uploads จากตัวอย่างมาตรฐานของระบบอื่นไม่ใช่เหตุผลให้ลบหรือสร้าง path นั้นใน ACC
ถ้าจำเป็นต้องแก้ template ที่ป้องกันไว้ ให้ขออนุมัติการแก้ policy แบบเจาะจงผ่าน PR แยกก่อน
ไฟล์ `.env*.example` เป็นตัวอย่างที่อนุญาต แต่ต้องไม่มี secret จริง

## เอกสารอ้างอิง

- [GitHub branch protection API](https://docs.github.com/en/rest/branches/branch-protection)
- [GitHub deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
