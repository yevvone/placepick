const errorController = {
  logErrors: (err, req, res, next) => {
    console.error('Error:', err.stack);
    next(err);
  },

  respondNoResourceFound: (req, res) => {
    res.status(404).render('error', {
      title: '페이지를 찾을 수 없습니다',
      message: '요청하신 페이지가 존재하지 않습니다.',
      error: { status: 404 }
    });
  },

  respondInternalEroor: (err, req, res, next) => {
    res.status(500).render('error', {
      title: '서버 오류',
      message: '서버에서 오류가 발생했습니다.',
      error: { status: 500, stack: err.stack }
    });
  }
};

module.exports = errorController;
