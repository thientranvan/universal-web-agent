# Universal Web Agent

Chrome MV3 extension chạy trong side panel, dùng API key của provider OpenAI-compatible để đọc và điều khiển tab hiện tại.

## Cài đặt

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục repo này: `/home/tvt/dev/chrome-agent`.
5. Bấm icon extension để mở side panel.

## Cấu hình

Trong side panel, mở nút cài đặt và nhập:

- `Base URL`: ví dụ `https://api.openai.com/v1` hoặc endpoint của provider tương thích OpenAI.
- `API key`: key của provider.
- `Model`: model chat hỗ trợ tool calling. Nếu muốn dùng ảnh chụp màn hình, model cần hỗ trợ vision input.

## Khả năng hiện có

- Mỗi hostname/domain có một nhóm hội thoại riêng.
- Trong từng domain có thể tạo nhiều hội thoại, chọn lại hội thoại cũ, hoặc reset hội thoại hiện tại.
- Khi chuyển hướng trong cùng domain, side panel và hội thoại hiện tại vẫn được giữ.
- Đọc title, URL, text, heading, link, ảnh, form control của trang.
- Tóm tắt nội dung trang bằng lệnh tự nhiên.
- Lấy link ảnh/link trang đang hiển thị.
- Click, điền input/textarea/select, tick checkbox/radio.
- Chỉnh DOM runtime bằng `text`, `html`, `value`, `style`, hoặc `attribute`.
- Chạy JavaScript tùy ý trong tab hiện tại qua tool `page_run_script` khi bật quyền trong cài đặt.
- Bật autopilot để theo dõi tab định kỳ và tiếp tục thao tác/gửi tin khi người dùng đã ra lệnh rõ.
- Chụp màn hình vùng tab đang nhìn thấy và gửi cho model vision.
- Gửi HTTP request từ background script nếu bật quyền trong cài đặt.

Một số trang như `chrome://`, Chrome Web Store hoặc frame bị sandbox có thể không cho extension inject content script.
