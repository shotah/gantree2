package tools

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"math"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

func init() {
	image.RegisterFormat("png", "\x89PNG\r\n\x1a\n", png.Decode, png.DecodeConfig)
	image.RegisterFormat("jpeg", "\xff\xd8", jpeg.Decode, jpeg.DecodeConfig)
	image.RegisterFormat("webp", "RIFF", webp.Decode, webp.DecodeConfig)
}

// encodeJPEG is swapped in tests so the quality/edge ladder can be asserted
// without depending on real compressor output size.
var encodeJPEG = encodeJPEGStd

func encodeJPEGStd(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// FitSize scales w×h so the long edge is at most edge. Never upscales.
func FitSize(w, h, edge int) (int, int) {
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	if edge < 1 {
		edge = 1
	}
	long := max(w, h)
	scale := math.Min(1, float64(edge)/float64(long))
	return max(1, int(math.Round(float64(w)*scale))), max(1, int(math.Round(float64(h)*scale)))
}

func decodeImage(raw []byte) (image.Image, string, error) {
	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", errors.New("could not read that image")
	}
	return img, format, nil
}

func isJPEG(raw []byte) bool {
	return len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
}

// PrepareJPEG decodes PNG/JPEG/WebP, fits the long edge, then walks the
// quality ladder (0.9→0.6) and edge×0.75 until under maxBytes.
func PrepareJPEG(raw []byte, edge, maxBytes int) (data []byte, usedEdge int, err error) {
	img, format, err := decodeImage(raw)
	if err != nil {
		return nil, 0, err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	long := max(w, h)
	if format == "jpeg" && isJPEG(raw) && long <= edge && len(raw) <= maxBytes {
		return raw, long, nil
	}
	return shrinkToJPEG(img, edge, maxBytes)
}

func shrinkToJPEG(src image.Image, edge, maxBytes int) ([]byte, int, error) {
	b := src.Bounds()
	origW, origH := b.Dx(), b.Dy()
	long := max(origW, origH)
	target := min(edge, long)
	for {
		fw, fh := FitSize(origW, origH, target)
		fitted := resize(src, fw, fh)
		for _, q := range jpegQualities {
			data, err := encodeJPEG(fitted, q)
			if err != nil {
				return nil, 0, errors.New("could not encode jpeg")
			}
			if len(data) <= maxBytes {
				return data, target, nil
			}
		}
		next := int(math.Round(float64(target) * JPEGEdgeStep))
		if next < JPEGEdgeMin {
			break
		}
		target = next
	}
	return nil, 0, errors.New("image too large")
}

func resize(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	if b.Dx() == w && b.Dy() == h {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	return dst
}
