`youtube.json` stands in for the YouTube Data API. Search has about 100 calls a day, so a run spends none.

Its shape comes from real `search.list` and `videos.list` responses recorded for a Korean query and a lofi query: astral-plane "bold" letters, full-width letters, `P1DT37M3S`, `P0D` live streams, HTML entities. Titles, channels and ids are rewritten, because YouTube's terms don't let API data sit around for more than 30 days. The last rows are written by hand to break layouts and to fail in each way a video can fail.

`playerError` is not an API field: the stand-in player raises it.
