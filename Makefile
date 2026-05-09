CXX = g++

SNDFILE_PREFIX    := $(shell brew --prefix libsndfile)
NLOHMANN_PREFIX   := $(shell brew --prefix nlohmann-json)

CXXFLAGS = -std=c++17 -Wall \
  -I$(NLOHMANN_PREFIX)/include \
  -I$(SNDFILE_PREFIX)/include

LDFLAGS = -L$(SNDFILE_PREFIX)/lib

LIBS = -lsndfile

TARGET = main
SRC = main.cpp

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET) $(LDFLAGS) $(LIBS)

clean:
	rm -f $(TARGET)