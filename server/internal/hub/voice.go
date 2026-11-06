package hub

// voice sets a person's voice state. Track B owns this file.
func (r *liveRoom) voice(c *conn, message Message) {
	c.fail(message.ID, "unknown", "Unknown message.")
}
