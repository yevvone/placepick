# PlacePick

PlacePick is a web application that extracts location information from Instagram posts and images. It uses OCR technology to recognize text from images and provides location-based services.

## Features

- Extract location information from Instagram posts
- Image text recognition using OCR
- Location-based search and filtering
- User-friendly interface

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. Clone the repository:
```bash
git clone [your-repository-url]
cd placepick
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your environment variables:
```
OCR_API_KEY=your_ocr_api_key
```

4. Start the server:
```bash
node sever.js
```

5. Open your browser and navigate to `http://localhost:3000`

## Project Structure

- `sever.js` - Main server file
- `index.html` - Frontend interface
- `design.css` - Styling
- `api.js` - API integration
- `uploads/` - Directory for uploaded images
- `eng.traineddata` - English language data for OCR
- `kor.traineddata` - Korean language data for OCR

## Technologies Used

- Node.js
- Express.js
- OCR.space API
- HTML/CSS/JavaScript

## License

This project is licensed under the MIT License. 