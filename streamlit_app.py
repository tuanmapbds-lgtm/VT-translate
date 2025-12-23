import streamlit as st
import google.generativeai as genai

# 1. Cấu hình trang (Tiêu đề tab, icon)
st.set_page_config(page_title="VTTrans", page_icon="🤖")

# 2. Tiêu đề hiển thị
st.title("VTTrans")

# 3. Nhập API Key (Cách bảo mật: Lấy từ Secrets của Streamlit)
# Nếu bạn muốn hardcode (không khuyến khích nhưng nhanh): api_key = "PASTE_KEY_CUA_BAN_VAO_DAY"
# Cách chuẩn:
if "GOOGLE_API_KEY" in st.secrets:
    api_key = st.secrets["GOOGLE_API_KEY"]
else:
    st.error("Chưa cấu hình API Key.")
    st.stop()

genai.configure(api_key=api_key)

# 4. Cấu hình Model (Copy từ AI Studio dán đè vào đây nếu bạn chỉnh nhiều tham số)
generation_config = {
  "temperature": 1,
  "top_p": 0.95,
  "top_k": 64,
  "max_output_tokens": 8192,
}

model = genai.GenerativeModel(
  model_name="gemini-1.5-flash", 
  generation_config=generation_config,
  # system_instruction="Dán System Instruction của bạn vào đây",
)

# 5. Khởi tạo lịch sử chat
if "messages" not in st.session_state:
    st.session_state.messages = []

# 6. Hiển thị lịch sử chat cũ
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# 7. Xử lý khi người dùng nhập liệu
if prompt := st.chat_input("Nhập tin nhắn..."):
    # Hiển thị tin nhắn người dùng
    with st.chat_message("user"):
        st.markdown(prompt)
    st.session_state.messages.append({"role": "user", "content": prompt})

    # Gọi Google AI trả lời
    try:
        chat = model.start_chat(history=[
            {"role": m["role"], "parts": [m["content"]]} 
            for m in st.session_state.messages[:-1] # Lịch sử trừ tin nhắn mới nhất để gửi đúng format
        ])
        response = chat.send_message(prompt)
        
        # Hiển thị câu trả lời của AI
        with st.chat_message("model"):
            st.markdown(response.text)
        st.session_state.messages.append({"role": "model", "content": response.text})
        
    except Exception as e:
        st.error(f"Lỗi: {e}")
