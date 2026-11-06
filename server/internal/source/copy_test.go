package source

import (
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

func TestWhatPeopleReadIsASentence(t *testing.T) {
	for _, err := range []error{ErrUnsupportedURL, ErrUnavailable, ErrNoSearch, ErrNoEmbed, ErrOverBudget, ErrLive, ErrTooManyLinks, ErrLinksResting} {
		text := err.Error()
		first, _ := utf8.DecodeRuneInString(text)
		if !IsUserError(err) || !unicode.IsUpper(first) || !strings.HasSuffix(text, ".") {
			t.Errorf("%q reaches people, so it should be a capitalised sentence", text)
		}
	}
}
