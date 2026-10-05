# Sang Penjaga Abu

Game aksi 3D orisinal: bertahan di arena berkabut, menghindari serangan, dan menebas gerombolan mayat hidup. Seluruh arena, karakter, efek, dan tekstur dibuat secara prosedural—tidak memerlukan unduhan aset tambahan. Game dimainkan langsung di browser; renderer 2D ringan menjadi fallback jika WebGL2 tidak tersedia.

## Main

**Main langsung:** [Sang Penjaga Abu](https://lesti-sunarti.github.io/ken/). Tautan aktif setelah GitHub Pages diaktifkan satu kali:

1. Buka [pengaturan Pages repo](https://github.com/lesti-sunarti/ken/settings/pages).
2. Pada **Build and deployment → Source**, pilih **GitHub Actions** lalu simpan.
3. Buka tab **Actions** dan pilih workflow **Deploy Sang Penjaga Abu**. Jika belum berjalan otomatis, pilih **Run workflow** pada branch `hoplite/mytilene-05548326`; bila run awal gagal sebelum Pages aktif, pilih **Re-run jobs**.
4. Setelah deployment berhasil, game tersedia di tautan di atas. Push berikutnya akan menerbitkan versi terbaru otomatis.

GitHub Pages belum aktif di repo saat ini, jadi langkah pertama perlu dilakukan oleh pemilik repo. Game dapat langsung dicoba lewat Preview di lingkungan pengembangan.

Untuk menjalankannya secara lokal sebagai pengembang:

```sh
npm install
npm run dev
```

Buka alamat lokal yang ditampilkan Vite. Untuk menghasilkan build statis, jalankan `npm run build`; hasilnya ada di `dist/`.

## Kontrol

- **WASD** — bergerak; **mouse** — mengarahkan kamera.
- **Klik kiri** atau **F** — menebas.
- **Spasi** — mengelak dengan jeda kebal singkat.
- **Esc** — jeda. Di ponsel, gunakan tombol sentuh.

Lima gelombang harus ditaklukkan untuk bertahan hingga fajar. Render memakai Three.js/WebGL dengan pencahayaan, bayangan, bloom, kabut, serta simulasi gerak dan benturan real-time.
