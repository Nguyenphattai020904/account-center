# Account Center Manager

Web app quản lý tài khoản đăng nhập (game, server, tool...) với giao diện neon/anime 2D, backend Node.js + MySQL, và cổng đăng nhập Google chỉ cho phép đúng 1 tài khoản.

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + Express
- Database: MySQL
- Auth: Google Identity Services (ID token) + session cookie

## Features

- Đặt và cập nhật master password
- Thêm, sửa, xóa account
- Lưu lịch sử thay đổi password
- Tìm kiếm account theo title/user/type
- Chỉ cho phép đăng nhập bằng Google account được whitelist

## Project Structure

- `server.js`: API backend, session, auth, MySQL
- `index.html`: trang chính quản lý account
- `login.html`: trang đăng nhập Google
- `script.js`: logic trang chính
- `login.js`: logic đăng nhập Google
- `style.css`: giao diện
- `.env`: biến môi trường runtime

## Prerequisites

- Node.js 18+ (khuyến nghị LTS)
- MySQL đang chạy tại `127.0.0.1:3306`
- Tài khoản MySQL:
  - user: `root`
  - password: `ServBay.dev`

## Setup

1. Cài dependencies:

```bash
npm install
```

2. Tạo file `.env` (nếu chưa có):

```bash
cp .env.example .env
```

3. Cập nhật `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
SESSION_SECRET=your-long-random-secret
```

4. Chạy server:

```bash
npm start
```

Server mặc định chạy ở:

- `http://localhost:3000`

## Google Cloud Console Config

Tạo OAuth 2.0 Web Client và cấu hình:

- Authorized JavaScript origins:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000` (khuyến nghị thêm)

Luu y:

- App hiện dùng Google Identity callback token flow, khong bat buoc redirect URI callback cho flow nay.

## Login Restriction

Backend chỉ cho phép đúng email:

- `phattai02092004@gmail.com`

Whitelist này đang đặt trong `server.js` tại biến `allowedGoogleEmail`.

## Database

Server tự động:

- Tạo database `center` nếu chưa tồn tại
- Tạo các bảng cần thiết nếu chưa có

Bạn không bắt buộc phải chạy tay `mysql_setup.sql` trong luồng bình thường.

## API Notes

- API chính nằm ở `/api`
- Các route `/api` yêu cầu session đăng nhập hợp lệ
- Auth route:
  - `GET /auth/config`
  - `GET /auth/status`
  - `POST /auth/google`
  - `POST /auth/logout`

## Troubleshooting

1. Loi `Thiếu GOOGLE_CLIENT_ID trên server`

- Kiểm tra file `.env` có giá trị `GOOGLE_CLIENT_ID`
- Đảm bảo đã restart server sau khi sửa `.env`

2. Loi `EADDRINUSE: address already in use :::3000`

- Có process khác đang chiếm cổng 3000
- Dừng process đó hoặc chạy app ở port khác:

```bash
PORT=3100 npm start
```

3. Login Google thất bại

- Kiểm tra origin trong Google Console có đúng `http://localhost:3000`
- Kiểm tra tài khoản đăng nhập có đúng email whitelist

## Security Notes

- Session secret cần là chuỗi mạnh, không dùng `change-me` ở môi trường thật
- Dữ liệu password trong app đang được làm mờ cơ bản phía client, không phải chuẩn mã hóa production
- Nếu deploy public, nên thêm HTTPS, CSRF protection và hardening session config

## Run Checklist

- MySQL đang chạy
- `.env` có `GOOGLE_CLIENT_ID` + `SESSION_SECRET`
- `npm start` chạy không báo lỗi
- Mở `http://localhost:3000/login.html` để đăng nhập
