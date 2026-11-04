// ⚙️ 기능 스크립트

const imageModeBtn = document.getElementById('imageMode');
const urlModeBtn = document.getElementById('urlMode');
const imageSection = document.getElementById('imageInputSection');
const urlSection = document.getElementById('urlInputSection');
const processButton = document.getElementById('processButton');
const previewSection = document.getElementById('previewSection');
const previewImage = document.getElementById('previewImage');
const imageFileInput = document.getElementById('imageFile');
const loadingDiv = document.getElementById('loading');
const resultContainer = document.getElementById('resultContainer');
const postTextDiv = document.getElementById('postText');
const hashtagsDiv = document.getElementById('hashtags');


let uploadedImageURL = null;

// 🔁 모드: 이미지 업로드
imageModeBtn.addEventListener('click', () => {
  imageSection.style.display = 'block';
  urlSection.style.display = 'none';
  previewSection.style.display = 'none';
  resultContainer.style.display = 'none';
  loadingDiv.style.display = 'none';
  processButton.onclick = extractText;
});

// 🔁 모드: URL 입력
urlModeBtn.addEventListener('click', () => {
  imageSection.style.display = 'none';
  urlSection.style.display = 'block';
  previewSection.style.display = 'none';
  resultContainer.style.display = 'none';
  loadingDiv.style.display = 'none';
  processButton.onclick = extractContent;
});

// 기본 모드 설정
processButton.onclick = extractText;

// 📂 이미지 업로드 핸들러
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (file) {
    uploadedImageURL = URL.createObjectURL(file);
    console.log("이미지 업로드됨:", file.name);
  }
}

// 🖼 이미지 처리 함수
function extractText() {
  if (!uploadedImageURL) {
    alert("이미지를 먼저 업로드해주세요.");
    return;
  }

  loadingDiv.style.display = 'block'; // 로딩 시작
  resultContainer.style.display = 'none';

  // 예시 처리 시뮬레이션 (비동기처럼)
  setTimeout(() => {
    previewImage.src = uploadedImageURL;
    previewSection.style.display = 'block';

    // 결과 값 넣기 (여기서 서버 응답 대체)
    const resultText = "이미지에서 추출한 텍스트입니다.";
    const resultHashtags = "#샘플 #해시태그";

    postTextDiv.textContent = resultText;
    hashtagsDiv.textContent = resultHashtags;

    resultContainer.style.display = 'block';
    loadingDiv.style.display = 'none';
  }, 1000);
}

// 🔗 URL 처리 함수
function extractContent() {
  const url = document.getElementById('urlField').value.trim();

  if (url === "") {
    alert("URL을 입력해주세요.");
    return;
  }

  loadingDiv.style.display = 'block'; // 로딩 시작
  resultContainer.style.display = 'none';

  // 예시 처리 시뮬레이션
  setTimeout(() => {
    // 결과 값 넣기
    const resultText = "URL에서 추출한 게시글 내용입니다.";
    const resultHashtags = "#인스타그램 #분석완료";

    postTextDiv.textContent = resultText;
    hashtagsDiv.textContent = resultHashtags;

    resultContainer.style.display = 'block';
    loadingDiv.style.display = 'none';
  }, 1000);
}

// [1] 인스타그램 링크에서 텍스트 추출
async function extractContent() {
        const link = document.getElementById("instaLink").value;
        const loadingDiv = document.querySelector('.loading');
        const errorMessage = document.getElementById('errorMessage');
        const resultDiv = document.getElementById("result");
        
        if (!link) {
            showError('링크를 입력해주세요.');
            return;
        }

        try {
            loadingDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            errorMessage.style.display = 'none';

            const normalizedUrl = normalizeInstagramUrl(link);
            if (!normalizedUrl) {
                throw new Error('올바른 인스타그램 링크를 입력해주세요.');
            }

            // 백엔드로 POST 요청 (Instagram 링크 분석용)
            const response = await fetch('http://localhost:3000/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: normalizedUrl })
            });

            if (!response.ok) {
                throw new Error('서버 연결에 실패했습니다. 서버가 실행 중인지 확인해주세요.');
            }

            const data = await response.json();

            if (data.success) {
                document.getElementById("postText").innerText = data.data.text;
                document.getElementById("hashtags").innerText = data.data.hashtags;
                resultDiv.style.display = 'block';
            } else {
                throw new Error(data.error || '포스트 내용을 가져오는데 실패했습니다.');
            }

        } catch (error) {
            showError(error.message);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // [2] 링크 정규화 (www 붙이기 등)
    function normalizeInstagramUrl(url) {
        url = url.trim();
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        if (!url.includes('www.')) {
            url = url.replace('instagram.com', 'www.instagram.com');
        }

        return url;
    }

    // [3] 에러 메시지 표시 함수
    function showError(message) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.innerText = message;
        errorMessage.style.display = 'block';
        document.getElementById("result").style.display = 'none';
    }

    // [4] 결과 복사 기능
    function copyToClipboard() {
        const postText = document.getElementById("postText").innerText;
        const hashtags = document.getElementById("hashtags").innerText;
        const fullText = postText + '\n\n' + hashtags;
        
        navigator.clipboard.writeText(fullText).then(() => {
            alert('포스트 내용이 클립보드에 복사되었습니다!');
        });
    }

    // [5] 이미지 선택 핸들링 (미리보기 + 상태 저장)
    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const previewImage = document.getElementById('previewImage');
            previewImage.src = e.target.result;
            previewImage.style.display = 'block';
            
            document.getElementById('extractButton').style.display = 'inline-block';
            selectedImage = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // [6] Tesseract OCR 이미지 텍스트 추출
    async function extractText() {
        if (!selectedImage) {
            showError('이미지를 먼저 선택해주세요.');
            return;
        }

        const loadingDiv = document.querySelector('.loading');
        const errorMessage = document.getElementById('errorMessage');
        const resultDiv = document.getElementById("result");
        
        try {
            loadingDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            errorMessage.style.display = 'none';

            // Tesseract.js로 OCR 수행
            const text = await ocrSpaceImage(selectedImage, 'kor');

            // 해시태그 분리
            const hashtags = text.match(/#[\w가-힣]+/g) || [];
            const mainText = text.replace(/#[\w가-힣]+/g, '').trim();

            document.getElementById("postText").innerText = mainText;
            document.getElementById("hashtags").innerText = hashtags.join(' ');
            resultDiv.style.display = 'block';

        } catch (error) {
            showError(error.message);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // [7] 엔터키로도 텍스트 추출 가능하도록 처리
    document.getElementById('instaLink').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            extractContent();
        }
    });