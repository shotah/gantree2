package tools

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestFitSize(t *testing.T) {
	t.Parallel()
	w, h := FitSize(4000, 3000, 1600)
	if w != 1600 || h != 1200 {
		t.Fatalf("1600 fit = %dx%d", w, h)
	}
	w, h = FitSize(4000, 3000, 1200)
	if w != 1200 || h != 900 {
		t.Fatalf("1200 fit = %dx%d", w, h)
	}
	w, h = FitSize(64, 64, 1280)
	if w != 64 || h != 64 {
		t.Fatalf("no upscale = %dx%d", w, h)
	}
}

func TestShrinkLadderMatchesJpegFromFile(t *testing.T) {
	old := encodeJPEG
	t.Cleanup(func() { encodeJPEG = old })
	tries := []struct {
		w, q int
	}{}
	encodeJPEG = func(img image.Image, quality int) ([]byte, error) {
		b := img.Bounds()
		q := float64(quality) / 100
		tries = append(tries, struct{ w, q int }{b.Dx(), quality})
		size := int(float64(b.Dx()*b.Dy()) * q * 0.3)
		return make([]byte, size), nil
	}
	src := image.NewRGBA(image.Rect(0, 0, 4000, 3000))
	data, edge, err := shrinkToJPEG(src, 1600, 300_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > 300_000 {
		t.Fatalf("bytes = %d", len(data))
	}
	if edge != 1200 {
		t.Fatalf("edge = %d", edge)
	}
	if tries[0].w != 1600 || tries[0].q != 90 {
		t.Fatalf("first try = %+v", tries[0])
	}
	widths := uniqWidths(tries)
	if len(widths) != 2 || widths[0] != 1600 || widths[1] != 1200 {
		t.Fatalf("widths = %v", widths)
	}
	var at1600 []int
	for _, tr := range tries {
		if tr.w == 1600 {
			at1600 = append(at1600, tr.q)
		}
	}
	if !equalInts(at1600, jpegQualities) {
		t.Fatalf("qualities at 1600 = %v", at1600)
	}
}

func TestShrinkGivesUpAtFloor(t *testing.T) {
	old := encodeJPEG
	t.Cleanup(func() { encodeJPEG = old })
	smallest := int(^uint(0) >> 1)
	encodeJPEG = func(img image.Image, _ int) ([]byte, error) {
		w := img.Bounds().Dx()
		if w < smallest {
			smallest = w
		}
		return make([]byte, 500_000), nil
	}
	src := image.NewRGBA(image.Rect(0, 0, 4000, 3000))
	if _, _, err := shrinkToJPEG(src, 1600, 1_000); err == nil {
		t.Fatal("want too large")
	}
	if smallest < JPEGEdgeMin || smallest >= 480 {
		t.Fatalf("smallest edge = %d", smallest)
	}
}

func TestPrepareJPEGPassthrough(t *testing.T) {
	raw := tinyJPEG(t)
	got, edge, err := PrepareJPEG(raw, AvatarEdge, AvatarMaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, raw) {
		t.Fatal("small jpeg should pass through")
	}
	if edge < 1 {
		t.Fatalf("edge = %d", edge)
	}
}

func TestPrepareJPEGPNG(t *testing.T) {
	raw := tinyPNG(t, 32, 32)
	got, _, err := PrepareJPEG(raw, AvatarEdge, AvatarMaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !isJPEG(got) {
		t.Fatal("want jpeg out")
	}
}

func TestDecodeRejectsJunk(t *testing.T) {
	t.Parallel()
	if _, _, err := decodeImage([]byte("not an image")); err == nil {
		t.Fatal("want decode error")
	}
}

func tinyPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 200, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	data, err := encodeJPEGStd(img, 90)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func uniqWidths(tries []struct{ w, q int }) []int {
	seen := map[int]bool{}
	var out []int
	for _, tr := range tries {
		if !seen[tr.w] {
			seen[tr.w] = true
			out = append(out, tr.w)
		}
	}
	return out
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
