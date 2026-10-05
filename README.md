# Sang Penjaga Abu

Game aksi orisinal: bertahan di hutan berkabut, menghindari serangan, dan menebas gerombolan mayat hidup. Arena dan karakter dibangun secara prosedural, diperkaya tekstur PBR 1K dan HDRI hutan yang dibundel bersama game. Renderer utama memakai WebGL2; renderer Canvas 2D ringan menjaga game tetap dapat dimainkan jika WebGL2 tidak tersedia. Game dimainkan langsung di browser tanpa bergantung pada server aset eksternal.

## Aset

Tekstur tanah hutan ([Forest Floor](https://polyhaven.com/a/forest_floor)), kulit pinus ([Pine Bark](https://polyhaven.com/a/pine_bark)), batu berlumut, serta HDRI ([Forest Slope](https://polyhaven.com/a/forest_slope)) berasal dari [Poly Haven](https://polyhaven.com/) dan berlisensi [CC0](https://polyhaven.com/license). Berkasnya disertakan di repo, jadi game tidak perlu mengunduh aset dari Poly Haven saat dimainkan.

## Main

**Main langsung:** [Sang Penjaga Abu](https://lesti-sunarti.github.io/ken/). GitHub Pages sudah dikonfigurasi melalui GitHub Actions; push ke branch `hoplite/mytilene-05548326` memicu workflow **Deploy Sang Penjaga Abu**. Periksa tab [Actions](https://github.com/lesti-sunarti/ken/actions) untuk status versi terbaru.

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
