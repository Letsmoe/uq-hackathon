CXX = g++
CXXFLAGS = -std=c++11
INCLUDES = -I/opt/homebrew/include
LDFLAGS = -L/opt/homebrew/lib
LIBS = -lSoundTouch -lsndfile

TARGET = bpmdetect
SRC = bpmdetect.cpp

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(SRC) -o $(TARGET) $(LDFLAGS) $(LIBS)

clean:
	rm -f $(TARGET)

.PHONY: clean
