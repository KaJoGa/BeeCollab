# Yang hanya bisa dikerjakan pemilik

Terakhir diperbarui: 2026-10-07. Intinya: **tidak ada yang wajib**. Aplikasi sudah live dan teruji (REST 45/45, WebSocket 41/41, E2E 64/64, di lokal **dan** di produksi). Semua item di bawah **opsional**, diurutkan dari yang paling berguna.

---

## 1. (Disarankan) Aktifkan pembersih data QA di Render
Tes otomatis membuat akun `@qa.beecollab.test` di database Neon-mu. Satu kali run penuh E2E membuat sekitar 90 akun. Datanya kecil, tapi menumpuk. Endpoint pembersih sudah ada di kode, **tapi mati secara default** (balas 404 seperti route yang tidak ada). Untuk menyalakannya:

1. Buat token acak (simpan di catatan pribadi, **jangan** kirim ke chat atau commit):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
2. Di dashboard Render → service backend → **Environment** → tambah dua variabel:

   | Key | Value |
   |---|---|
   | `TEST_SUPPORT_ENABLED` | `true` |
   | `TEST_ADMIN_TOKEN` | *(tempel hasil langkah 1 saja, minimal 16 karakter)* |

   Kolom Value hanya berisi nilainya: `true` untuk yang pertama (tanpa tanda kutip atau kata tambahan) dan token itu sendiri untuk yang kedua. Simpan; Render akan deploy ulang (koneksi WebSocket yang sedang berjalan terputus, jadi lakukan saat tidak ada yang call).
3. **Cek dulu status fitur lewat `/health`** (tanpa token, aman dibuka di browser): `https://beecollab-rwbj.onrender.com/health` harus memuat `"testSupport":"enabled"`. Kalau `"disabled"`, buka Render → **Logs** dan cari baris `QA endpoints disabled:`; alasannya tertulis di sana, misalnya `TEST_SUPPORT_ENABLED must be exactly "true" (got "…")` atau `TEST_ADMIN_TOKEN must be at least 16 characters (got N)`. Kalau `/health` tidak punya field `testSupport` sama sekali, Render belum menjalankan versi terbaru (lihat `commit`). Lalu cek endpoint-nya:
   ```powershell
   curl.exe -H "x-test-token: TOKEN_KAMU" https://beecollab-rwbj.onrender.com/test-support/status
   ```
   Harus muncul `"enabled":true` dan jumlah akun uji. Tanpa token atau dengan token salah → `401`. Kalau `404`: fitur belum aktif (lihat `/health` dan log di atas). Kode memang sengaja membalas 404 yang identik dengan route yang tidak ada saat fitur mati, jadi pembeda satu-satunya adalah `/health` dan log startup. Spasi, huruf besar-kecil (`TRUE`) dan tanda kutip yang ikut tersalin sudah ditoleransi; kalimat penjelasan yang ikut tersalin tidak.
4. Pakai: `cd test` lalu `TEST_ADMIN_TOKEN=... API_URL=https://beecollab-rwbj.onrender.com npm run cleanup`, atau otomatis setelah E2E: `QA_CLEANUP=1 TEST_ADMIN_TOKEN=... npm run e2e`.

**Keamanan:** endpoint ini hanya menghapus data milik akun berakhiran `@qa.beecollab.test` (data nyata tidak tersentuh; terbukti lewat tes integrasi), butuh token, dan token dibandingkan dengan cara aman terhadap timing attack. Kalau selesai testing, hapus kedua variabel di Render dan endpoint kembali 404.
Kalau tidak mau mengaktifkannya: tidak masalah, tes tetap jalan. Alternatif lain: `test/tools/cleanup.sql` untuk SQL Editor Neon, **tapi SQL itu belum pernah dijalankan** (lihat catatan di file); coba dulu di database lokal.

## 2. Serahkan folder `test/` ke Claude QA
Folder `test/` sudah berisi semuanya: dokumen 01–09, alat, dan 64 tes. Cara paling mudah:
1. Buka Claude Code di folder repo (`D:\Project\BeeCollab`) atau langsung di `D:\Project\BeeCollab\test` (ada `CLAUDE.md` khusus QA di sana).
2. Kirim prompt seperti ini:
   > Kamu QA engineer untuk BeeCollab. Baca `test/README.md`, lalu dokumen 01 sampai 09 berurutan. Jalankan `npm install`, `npx playwright install chromium`, `npm run smoke` dan `npm run e2e` di lokal untuk memastikan baseline hijau, lalu ulangi terhadap produksi (WEB_URL=https://beecollab.vercel.app, API_URL=https://beecollab-rwbj.onrender.com). Setelah itu kerjakan sprint pertama di `test/06-test-ideas.md` bagian 8, dan laporkan temuan dengan template di `test/09-reporting.md`. Jangan ubah kode aplikasi.
3. Kalau QA butuh menjalankan di lokal: backend + frontend harus hidup (lihat `test/02-environments-and-access.md`; `run.bat` menyalakan keduanya).
4. Kalau kamu sudah mengaktifkan item 1, berikan `TEST_ADMIN_TOKEN` **hanya** lewat environment variable di sesi QA.

## 3. Pengecekan manual yang tidak bisa kulakukan (opsional, ± 10 menit)
| Cek | Kenapa | Cara |
|---|---|---|
| **Screen share** sungguhan | browser headless tidak punya layar untuk dibagikan; `getDisplayMedia` tidak teruji | dua tab/perangkat di meeting yang sama, klik ikon share screen, lihat tampilan "layar besar + sidebar" |
| **HP sungguhan** | tata letak mobile hanya dicek lewat kode | buka https://beecollab.vercel.app di HP, buat/gabung meeting, coba menu titik tiga dan tombol chat/people |
| **Call lintas jaringan** | sudah kamu tes sebelumnya | tidak perlu diulang |

## 4. Setelah QA selesai: putuskan mana yang diperbaiki
Daftar kelemahan sudah ada di `test/07-observed-behaviors-and-risks.md` (ID `R-xx`), sebagian besar sudah **terbukti** dan sengaja **tidak diperbaiki** supaya jadi temuan QA. Setelah laporan QA masuk, pilih mana yang diperbaiki dan mana yang dibiarkan sebagai "known issue" di portfolio. Yang paling berdampak: R-04/R-08/R-09 (otorisasi), R-06/R-07 (kick dan mute untuk guest), R-17 (join dengan kode huruf kecil macet), R-21 (host sendirian putus = meeting hilang), R-24 (pesan sendiri tampil seperti pesan orang lain).

## 5. Perawatan ringan
* **Kuota gratis:** cek dashboard Render (jam instance, 750/bulan) dan Neon (CU-hours, 100/bulan, 1 GB) sesekali. Satu run penuh E2E di produksi membuat Neon aktif ± 5 menit.
* **Setiap push ke `main` men-deploy ulang** Render dan Vercel dan memutus call yang sedang berjalan. `GET /health` menampilkan `commit` yang sedang live.
* **Kerentanan dependency (`npm audit`):** sudah dibereskan di dependency produksi, kecuali 6 temuan di rantai CLI Prisma (hanya dipakai saat build, bukan di server). Itu **sengaja dibiarkan**: "perbaikan" yang disarankan npm adalah downgrade ke Prisma 6. Jangan jalankan `npm audit fix --force`. Cek lagi sesekali dengan `npm audit --omit=dev` di folder backend dan frontend.
* **Jangan buat service Render lain:** semua service free berbagi jatah 750 jam.
* Kalau kamu pernah membuat file `bee-collab-backend/.env.production.local` (berisi string koneksi Neon), hapus setelah tidak dipakai. File itu di-ignore git, tapi berisi rahasia.
* `package-lock.json` backend dan frontend punya perubahan kecil dari `npm install` yang sengaja **tidak** di-commit (hanya noise).
* File scratch lokal `test/tools/_seedmix.mjs` di-ignore git dan boleh dihapus.

## 6. Kalau ada yang rusak
| Gejala | Cek |
|---|---|
| Situs menampilkan banner "Waking up the server" terus-menerus | buka `https://beecollab-rwbj.onrender.com/health`; kalau `db:"down"`, lihat log Render untuk baris `DB check failed: …` |
| `/health` bukan commit terbaru | Render masih build/deploy; cek tab Events/Logs |
| Frontend tidak berubah setelah push | cek deployment di Vercel (status commit di GitHub juga menampilkannya) |
| CORS error di browser | `FRONTEND_ORIGIN` di Render harus persis `https://beecollab.vercel.app` (tanpa garis miring) |
| Call tidak tersambung di jaringan tertentu | `GET /webrtc/ice-servers` (butuh token) harus memuat entri `turn:`; kalau tidak, cek `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` di Render |
| Cek cepat seluruh sistem | `cd test && npm run wait && npm run smoke` (set `API_URL`) |
