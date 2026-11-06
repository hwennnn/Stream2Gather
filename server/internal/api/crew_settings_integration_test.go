package api

import (
	"context"
	"net/http"
	"testing"

	"stream2gather/internal/store"
)

// crewWithFriend is a crew of two, with both people's request options.
func crewWithFriend(t *testing.T, s *Server) (slug, token, friendID string, owner, friend func(*http.Request)) {
	t.Helper()
	_, owner = signUp(t, s, "Hana")
	slug, token = newCrew(t, s, owner)
	claims, friend := signUp(t, s, "Mika")
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, friend); response.Code != http.StatusOK {
		t.Fatalf("join: %d", response.Code)
	}
	return slug, token, claims.Subject, owner, friend
}

func TestOnlyTheOwnerChangesTheCrew(t *testing.T) {
	s, _ := stackServer(t)
	slug, _, _, owner, friend := crewWithFriend(t, s)
	path := "/v1/crews/" + slug
	if response, _ := serve(s, http.MethodPatch, path, `{"name":"Mine"}`, friend); response.Code != http.StatusForbidden {
		t.Fatalf("patch as member: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodDelete, path, "", friend); response.Code != http.StatusForbidden {
		t.Fatalf("delete as member: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPost, path+"/invite", "", friend); response.Code != http.StatusForbidden {
		t.Fatalf("rotate as member: %d", response.Code)
	}

	response, _ := serve(s, http.MethodPatch, path, `{"name":"Sunday club","guestAccess":false}`, owner)
	if response.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", response.Code, response.Body)
	}
	_, home := serve(s, http.MethodGet, path, "", owner)
	if home["name"] != "Sunday club" || home["guestAccess"] != false {
		t.Fatalf("home: %v", home)
	}
}

func TestTransferNeedsAMemberAndMovesTheRights(t *testing.T) {
	s, _ := stackServer(t)
	slug, _, friendID, owner, friend := crewWithFriend(t, s)
	path := "/v1/crews/" + slug
	response, body := serve(s, http.MethodPatch, path, `{"ownerId":"u_nobody"}`, owner)
	if response.Code != http.StatusConflict || body["code"] != "not_member" {
		t.Fatalf("transfer to a stranger: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPatch, path, `{"ownerId":"`+friendID+`"}`, owner); response.Code != http.StatusOK {
		t.Fatalf("transfer: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPatch, path, `{"name":"Old owner"}`, owner); response.Code != http.StatusForbidden {
		t.Fatalf("old owner kept the rights: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPatch, path, `{"name":"New owner"}`, friend); response.Code != http.StatusOK {
		t.Fatalf("new owner: %d", response.Code)
	}
}

func TestRotatingTheInviteRetiresTheOldLink(t *testing.T) {
	s, _ := stackServer(t)
	slug, token, _, owner, _ := crewWithFriend(t, s)
	_, rotated := serve(s, http.MethodPost, "/v1/crews/"+slug+"/invite", "", owner)
	fresh := rotated["inviteToken"].(string)
	if fresh == "" || fresh == token {
		t.Fatalf("token = %q", fresh)
	}
	_, late := signUp(t, s, "Late")
	response, body := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, late)
	if response.Code != http.StatusForbidden || body["code"] != "invalid_invite" {
		t.Fatalf("old link: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+fresh+`"}`, late); response.Code != http.StatusOK {
		t.Fatalf("new link: %d", response.Code)
	}
}

func TestClosingACrewClosesTheRoomAndClearsWhatItKept(t *testing.T) {
	s, pool := stackServer(t)
	ctx := context.Background()
	slug, _, friendID, owner, friend := crewWithFriend(t, s)
	record, err := s.DB.RoomBySlug(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.InsertMessage(ctx, record.ID, store.Message{UserID: friendID, Author: "Mika", Body: "hello"}); err != nil {
		t.Fatal(err)
	}
	if response, _ := serve(s, http.MethodDelete, "/v1/crews/"+slug, "", owner); response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodGet, "/v1/rooms/"+slug, "", friend); response.Code != http.StatusGone {
		t.Fatalf("room after delete: %d", response.Code)
	}
	var crews, messages int
	var snapshot []byte
	err = pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM crews WHERE room_id = r.id), (SELECT count(*) FROM messages WHERE room_id = r.id), r.snapshot
		FROM rooms r WHERE r.id = $1`, record.ID).Scan(&crews, &messages, &snapshot)
	if err != nil || crews != 0 || messages != 0 || snapshot != nil {
		t.Fatalf("crews = %d, messages = %d, snapshot = %s, err = %v", crews, messages, snapshot, err)
	}
}

func TestNotifyIsPerMember(t *testing.T) {
	s, pool := stackServer(t)
	slug, _, friendID, _, friend := crewWithFriend(t, s)
	path := "/v1/crews/" + slug + "/me"
	if response, _ := serve(s, http.MethodPatch, path, `{"notify":"sometimes"}`, friend); response.Code != http.StatusBadRequest {
		t.Fatalf("bad value: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodPatch, path, `{"notify":"off"}`, friend); response.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", response.Code, response.Body)
	}
	var off int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM crew_members m JOIN crews c ON c.id = m.crew_id JOIN rooms r ON r.id = c.room_id
		WHERE r.slug = $1 AND m.notify = 'off' AND m.user_id = $2`, slug, friendID).Scan(&off)
	if err != nil || off != 1 {
		t.Fatalf("off = %d, err = %v", off, err)
	}
	_, stranger := signUp(t, s, "Stranger")
	if response, _ := serve(s, http.MethodPatch, path, `{"notify":"off"}`, stranger); response.Code != http.StatusConflict {
		t.Fatalf("stranger: %d", response.Code)
	}
}

func TestLeavingAndRemoval(t *testing.T) {
	s, _ := stackServer(t)
	slug, token, friendID, owner, friend := crewWithFriend(t, s)
	members := "/v1/crews/" + slug + "/members/"

	_, home := serve(s, http.MethodGet, "/v1/crews/"+slug, "", owner)
	ownerID := home["ownerId"].(string)
	if response, body := serve(s, http.MethodDelete, members+ownerID, "", owner); response.Code != http.StatusConflict || body["code"] != "owner_stays" {
		t.Fatalf("owner leaving: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodDelete, members+ownerID, "", friend); response.Code != http.StatusForbidden {
		t.Fatalf("member removing the owner: %d", response.Code)
	}
	if response, _ := serve(s, http.MethodDelete, members+friendID, "", friend); response.Code != http.StatusOK {
		t.Fatalf("leaving: %d %s", response.Code, response.Body)
	}
	if response, _ := serve(s, http.MethodDelete, members+friendID, "", friend); response.Code != http.StatusConflict {
		t.Fatalf("leaving twice: %d", response.Code)
	}
	// Leaving keeps the invite, so a friend who left by mistake can come back.
	if response, _ := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, friend); response.Code != http.StatusOK {
		t.Fatalf("rejoin: %d %s", response.Code, response.Body)
	}

	if response, _ := serve(s, http.MethodDelete, members+friendID, "", owner); response.Code != http.StatusOK {
		t.Fatalf("removal: %d %s", response.Code, response.Body)
	}
	response, body := serve(s, http.MethodPost, "/v1/crews/"+slug+"/join", `{"token":"`+token+`"}`, friend)
	if response.Code != http.StatusForbidden || body["code"] != "invalid_invite" {
		t.Fatalf("a removal must retire the invite: %d %s", response.Code, response.Body)
	}
}

func TestRailListsOnlyMyOpenCrews(t *testing.T) {
	s, _ := stackServer(t)
	_, as := signUp(t, s, "Hana")
	kept, _ := newCrew(t, s, as)
	closed, _ := newCrew(t, s, as)
	if response, _ := serve(s, http.MethodDelete, "/v1/crews/"+closed, "", as); response.Code != http.StatusOK {
		t.Fatalf("delete: %d", response.Code)
	}
	response, body := serve(s, http.MethodGet, "/v1/me/crews", "", as)
	items := body["items"].([]any)
	if response.Code != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["slug"] != kept || items[0].(map[string]any)["here"] != 0.0 {
		t.Fatalf("rail: %d %s", response.Code, response.Body)
	}
	guest := fresh()
	if response, _ := serve(s, http.MethodGet, "/v1/me/crews", "", guest); response.Code != http.StatusUnauthorized {
		t.Fatalf("guest: %d", response.Code)
	}
}
