## Usage
- `./main audios/[FILENAME]`
- output JSON `charts/[FILENAME]`

- `bun install`
- `bun run dev --host`

## ISSUES
### Frontend
- Music not playing
- ~nowhere to set scanline speed(?) currently one page is approx two pages (at least on mac)~
- Drags (type 3) and swipes (type 1) not rendering correctly
- Doesnt work on iphone browser
- cannot resume once full screened... maybe fullscreen by default?
### Backend
- the pattern generator is trash


## Dependencies

### Backend
- [sound-touch](https://www.surina.net/soundtouch/readme.html)
- `/opt/homebrew/bin/brew install sound-touch libsndfile`
- `nlohmann-json`
### Frontend
- ~https://docs.nativescript.org/setup/macos~ FUCK THIS WE DOING WEBAPP
- [Bun](https://bun.sh/)

## JSON
- scanline (can have multiples)
	- speed
	- start timestamp
- element (would have multiples)
	- type
	- timestamp
	- coordinate
		- ratio
TBD units \
~TBD who manage the drag thingy connect lines (its more of a visual thing so i believe frontend)~ Connect lines of an array, nested notes

<!-- ```json
	{
	  "scanlines": [
	    {
	      "speed": 178,
	      "start_time": 0
	    },
	    {
	      "speed": 89,
	      "start_time": 420
	    }
	  ],
	  "elements": [
	    {
	      "type": "note",
	      "timestamp": 0,
	      "coordinate": {
	        "x": 420,
	        "y": 69
	      }
	    },
	    {
	      "type": "swipe",
	      "timestamp": 69,
	      "coordinate": {
	        "x": 69,
	        "y": 69
	      }
	    }
	    {
	      "type": "hold",
	      "timestamp": 420,
	      "coordinate": {
	        "x": 69,
	        "y": 69
	      },
	      "duration": 5
	    }
	    {
	      "type": "drag",
	      "timestamp": 420,
	      "coordinate": {
	        "x": 69,
	        "y": 69
	      }
	    }
	  ]
	}
``` -->

- Note types
	- 0: tap
	- 1: swipe
	- 2: hold
	- 3: drag (nested)

TBD what do if a hold goes more than one page - fron
Page redundent?
```json
{
	"time_base": 480,
	"start_offset_time": 0,
	"page_list": [
		{
	      "start_tick": 0,
	      "end_tick": 1920, // 2~4 beats per page
	      "scan_line_direction": -1
	    },
	    {
	      "start_tick": 1920,
	      "end_tick": 3840,
	      "scan_line_direction": 1
	    },
	    //...
	],
	"note_list": [
		{
	      "type": 0,
	      "id": 0,
	      "tick": 69,
	      "x": 0.42069,
	      "duration": 0
	    },
	    {
	      "type": 2,
	      "id": 1,
	      "tick": 420,
	      "x": 0.42069,
	      "duration": 240
	    },
	    {
		  "type": 3,
		  "id": 2,
		  "nodes": [
		    { "tick": 2400, "x": 0.420, "duration": 0 },
		    { "tick": 2520, "x": 0.690, "duration": 0 }
		  ]
		}
	]
}

```


## Features
### Main
- EZ Mode (Half speed scanlines)
- HD Mode (Full speed scanlines)
- **Scanline**
	- Formulas
	`time_in_sec = 60*tick/bpm/time_base`


- Tap note at beats
- Reasonable layout of notes for gameplay
	- [Patterns](https://sites.google.com/site/cytoidcommunity/charting/extra-information-on-charting/patterns)
- **Audio upload & send to backend**
- A scoring system
	- Hit accuracy metric
	- counter
	- overall scores
	- https://cytus.fandom.com/wiki/Combo


### Advanced
- An edit mode for customised mode
- drag/ hold/ swipe
- scanline speed change and still makes sense (maybe jump btwn half and full speed)
- Fancy main page (Chungussi is working on it :3)
