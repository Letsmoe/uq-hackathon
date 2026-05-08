## Dependencies

### Backend
- [sound-touch](https://www.surina.net/soundtouch/readme.html)
- `/opt/homebrew/bin/brew install sound-touch libsndfile`
### Frontend
- ~[](https://docs.nativescript.org/setup/macos)~ FUCK THIS WE DOING WEBAPP


## JSON
- scanline (can have multiples)
	- speed
	- start timestamp
- element (would have multiples)
	- type
	- timestamp
	- coordinate
		- TBD pixel/ grid/ ratio
TBD units
TBD who manage the drag thingy connect lines (its more of a visual thing so i believe frontend)

```json
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
```


## Features
### Main
- EZ Mode (Half speed scanlines)
- HD Mode (Full speed scanlines)
- Tap note at beats
- Reasonable layout of notes for gameplay
- Audio upload & send to backend
- A scoring system
	- Hit accuracy metric
	- counter
	- overall scores


### Advanced
- An edit mode for customised mode
- drag/ hold/ swipe
- scanline speed change and still makes sense (maybe jump btwn half and full speed)
- Fancy main page (Chungussi is working on it :3)
