package hub

import (
	"encoding/json"
)

// voiceStates maps what a client reports to what the room shows.
var voiceStates = map[string]string{"listening": "listening", "muted": "muted", "live": "live", "off": ""}

// voice records where this tab is in the call. It's kept on the connection, so a
// closed tab takes it along, and a reconnecting client has to say it again.
func (r *liveRoom) voice(c *conn, message Message) {
	var request struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(message.Data, &request); err != nil {
		c.fail(message.ID, "bad_message", "That message could not be read.")
		return
	}
	state, known := voiceStates[request.State]
	if !known {
		c.fail(message.ID, "invalid", "That action is not valid.")
		return
	}
	if !c.voiceRate.Allow() {
		c.fail(message.ID, "rate_limited", "Slow down a little.")
		return
	}
	r.do(func() {
		// A write after leave would put this tab back in the room for a while.
		if _, joined := r.conns[c]; joined && c.setVoice(state) {
			ctx, cancel := opContext()
			defer cancel()
			if err := r.hub.live.Touch(ctx, r.id, c.id, c.who()); err != nil {
				r.hub.log.Warn("presence write failed", "room", r.id, "error", err)
			}
			r.publishMembers(ctx)
		}
		c.ack(message.ID)
	})
}

// setVoice reports whether that changed anything.
func (c *conn) setVoice(state string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	changed := c.person.Voice != state
	c.person.Voice = state
	return changed
}
