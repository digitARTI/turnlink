#include <dlfcn.h>
#include <stdio.h>

// Availability only. This does not create an Endpoint Security client,
// subscribe to events, inspect other processes, or claim cleanup authority.
int main(void) {
    void *framework = dlopen("/usr/lib/libEndpointSecurity.dylib", RTLD_LAZY | RTLD_LOCAL);
    if (!framework) {
        fprintf(stderr, "EndpointSecurity framework unavailable: %s\n", dlerror());
        return 1;
    }
    void *symbol = dlsym(framework, "es_new_descendants_client");
    printf("descendants client %s\n", symbol ? "available" : "unavailable");
    dlclose(framework);
    return 0;
}
