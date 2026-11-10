# Included into every CMake project by scripts/build/lowmem.init.gradle (CMAKE_PROJECT_INCLUDE):
# at most 2 concurrent compiles and 1 link per Ninja build.
set_property(GLOBAL PROPERTY JOB_POOLS thora_compile=2 thora_link=1)
set(CMAKE_JOB_POOL_COMPILE thora_compile)
set(CMAKE_JOB_POOL_LINK thora_link)
