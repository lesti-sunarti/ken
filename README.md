# Sang Penjaga Abu

Game aksi 3D orisinal: bertahan di arena berkabut, menghindari serangan, dan menebas gerombolan mayat hidup. Seluruh arena, karakter, efek, dan tekstur dibuat secara prosedural—tidak memerlukan unduhan aset tambahan. Game dimainkan langsung di browser; renderer 2D ringan menjadi fallback jika WebGL2 tidak tersedia.

## Main

Game berjalan langsung di browser desktop atau ponsel. Untuk menerbitkan build statis, jalankan `npm run build` dan letakkan isi `dist/` di hosting statis.

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
