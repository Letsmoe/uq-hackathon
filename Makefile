CXX = em++

CXXFLAGS = -std=c++17 -Wall -O3

TARGET = main.js
SRC = main.cpp

EMFLAGS = \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_analyze_audio_json","_free_result","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","UTF8ToString","stringToUTF8","lengthBytesUTF8"]'

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET) $(EMFLAGS)

clean:
	rm -f main.js main.wasm
