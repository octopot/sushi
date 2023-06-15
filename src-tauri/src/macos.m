#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/hidsystem/IOHIDEventSystemClient.h>
#import <IOKit/hidsystem/IOHIDServiceClient.h>
#include <errno.h>
#include <signal.h>
#include <unistd.h>

// Window operations and these focus transitions run on AppKit's main thread.
static NSRunningApplication *previousApplication;

void sushi_remember_frontmost(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (app && app.processIdentifier != NSProcessInfo.processInfo.processIdentifier) {
        previousApplication = app;
    }
}

// A transparent window's shadow follows the alpha of its content: the rounded glass.
// AppKit caches that outline, so recompute it once the content has redrawn.
static void refresh_shadow(NSWindow *window) {
    // Apply the corner mask from shape_window; AppKit only re-reads it when told.
    SEL changed = NSSelectorFromString(@"_cornerMaskChanged");
    if ([window respondsToSelector:changed]) ((void (*)(id, SEL))objc_msgSend)(window, changed);
    [window invalidateShadow];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        [window invalidateShadow];
    });
}

// The web page paints no window-shaped layer, so the glass carries the legibility tint.
// As the glass's content view the fill is clipped to the glass's own continuous corner.
// NSGlassEffectView.tintColor tints too faintly for body text over a busy wallpaper.
@interface SushiTint : NSView
@end

@implementation SushiTint
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
    BOOL dark = [[self.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
    NSColor *tint = dark ? [NSColor colorWithSRGBRed:24 / 255.0 green:24 / 255.0 blue:27 / 255.0 alpha:0.52]
                         : [NSColor colorWithSRGBRed:250 / 255.0 green:250 / 255.0 blue:250 / 255.0 alpha:0.56];
    self.layer.backgroundColor = tint.CGColor;
}
- (void)viewDidChangeEffectiveAppearance { self.needsDisplay = YES; }
@end

// macOS 25 and older get the untinted Visual Effect fallback.
static void tint_glass(NSWindow *window, int attempts) {
    Class glass = NSClassFromString(@"NSGlassEffectView");
    if (!glass) return;
    for (NSView *view in window.contentView.subviews) {
        if ([view isKindOfClass:glass]) {
            if (![[(id)view contentView] isKindOfClass:SushiTint.class]) {
                SushiTint *tint = [[SushiTint alloc] initWithFrame:view.bounds];
                tint.wantsLayer = YES;
                tint.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
                [(id)view setContentView:tint];
            }
            return;
        }
    }
    // Tauri inserts the glass in a later main-thread task; try again shortly.
    if (attempts <= 0) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        tint_glass(window, attempts - 1);
    });
}

// A borderless window has no corner mask, so the window server is free to outline, clip and
// shadow it with a shape other than the glass. Supply the glass outline: a stretchable mask
// with the same 26pt continuous corner. This overrides AppKit's private -_cornerMask (as
// Electron does for windows with rounded vibrancy); on a system without it nothing changes.
static const CGFloat CORNER = 26;

static NSImage *corner_mask(void) {
    static NSImage *mask;
    if (mask) return mask;
    CGFloat side = ceil(CORNER * 1.6) * 2 + 1, scale = 2;
    CALayer *shape = [CALayer layer];
    shape.frame = CGRectMake(0, 0, side, side);
    shape.cornerRadius = CORNER;
    shape.cornerCurve = kCACornerCurveContinuous;
    shape.backgroundColor = NSColor.blackColor.CGColor;
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, side * scale, side * scale, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGContextScaleCTM(context, scale, scale);
    [shape renderInContext:context];
    CGImageRef bitmap = CGBitmapContextCreateImage(context);
    mask = [[NSImage alloc] initWithCGImage:bitmap size:NSMakeSize(side, side)];
    CGFloat cap = floor(side / 2);
    mask.capInsets = NSEdgeInsetsMake(cap, cap, cap, cap);
    mask.resizingMode = NSImageResizingModeStretch;
    CGImageRelease(bitmap);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    return mask;
}

static void shape_window(NSWindow *window) {
    SEL selector = NSSelectorFromString(@"_cornerMask");
    Method inherited = class_getInstanceMethod(NSWindow.class, selector);
    if (!inherited) return;
    class_addMethod(window.class, selector, imp_implementationWithBlock(^NSImage *(__unused id self) { return corner_mask(); }), method_getTypeEncoding(inherited));
}

// The panel is an overlay, as Spotlight is: a non-activating NSPanel takes the keyboard without
// activating Sushi, so macOS neither leaves a full-screen app's Space nor brings Sushi forward,
// and the app underneath keeps being the one the user returns to.
@interface SushiPanel : NSPanel
@end

@implementation SushiPanel
- (BOOL)canBecomeKeyWindow { return YES; }
@end

// Tao creates the window as its own NSWindow subclass. NSPanel adds no instance variables, so
// the window becomes a panel in place, the way tauri-nspanel converts Tauri windows; tao's
// own state stays where it was allocated.
static NSPanel *as_panel(NSWindow *window) {
    if (![window isKindOfClass:NSPanel.class]) {
        if (class_getInstanceSize(NSPanel.class) != class_getInstanceSize(NSWindow.class)) return nil;
        object_setClass(window, SushiPanel.class);
    }
    return (NSPanel *)window;
}

void sushi_prepare_window(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSPanel *panel = as_panel(window);
    if (panel) {
        panel.styleMask |= NSWindowStyleMaskNonactivatingPanel;
        panel.hidesOnDeactivate = NO;
        panel.becomesKeyOnlyIfNeeded = NO;
    }
    static id resized;
    if (!resized) {
        resized = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            refresh_shadow(note.object);
        }];
    }
    if (NSApp.hidden) [NSApp unhideWithoutActivation];
    shape_window(window);
    // Borderless windows have no shadow unless asked for one.
    window.hasShadow = YES;
    tint_glass(window, 40);
    // Shown on the Space the user is in, full screen included; Mission Control leaves it out
    // (transient) and window cycling skips it.
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    behavior &= ~(NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenNone |
                  NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorParticipatesInCycle);
    window.collectionBehavior = behavior | NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary |
                                NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
}

void sushi_refresh_shadow(void *native) {
    refresh_shadow((__bridge NSWindow *)native);
}

// Brings the panel up and gives it the keyboard without activating Sushi. A window that could
// not become a panel falls back to activating the app, as before.
void sushi_present(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    [window orderFrontRegardless];
    [window makeKeyWindow];
    if (![window isKindOfClass:NSPanel.class]) [NSApp activateIgnoringOtherApps:YES];
}

void sushi_restore_frontmost(void) {
    if (previousApplication && !previousApplication.terminated) {
        if (@available(macOS 14.0, *)) {
            [NSApp yieldActivationToApplication:previousApplication];
            [previousApplication activateFromApplication:NSRunningApplication.currentApplication options:0];
        } else {
            [previousApplication activateWithOptions:0];
        }
    } else {
        // Nobody to hand focus back to (e.g. shown by a reopen while already frontmost):
        // hiding the app makes the system activate the next app. sushi_prepare_window unhides.
        [NSApp hide:nil];
    }
    previousApplication = nil;
}

bool sushi_is_active(void) {
    return NSApp.active;
}

bool sushi_copy(const unsigned char *bytes, size_t count) {
    @autoreleasepool {
        NSString *text = [[NSString alloc] initWithBytes:bytes length:count encoding:NSUTF8StringEncoding];
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        [board clearContents];
        return [board setString:text forType:NSPasteboardTypeString];
    }
}

// Where Launch Services finds the app with this bundle identifier, as the Finder would.
// Writes a NUL-terminated path into out and returns true, or false when no app is registered.
bool sushi_app_path(const char *bundle_id, char *out, size_t size) {
    @autoreleasepool {
        NSString *identifier = [NSString stringWithUTF8String:bundle_id];
        NSURL *url = identifier ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier] : nil;
        return url.fileURL && [url getFileSystemRepresentation:out maxLength:size];
    }
}

// Asks every running app with this bundle identifier to quit and waits up to timeout seconds.
// Runs before NSApplication starts, so it watches the processes rather than KVO on
// NSRunningApplication. Returns true when none is left. v0.3.0: remove with migrate.rs.
bool sushi_quit_app(const char *bundle_id, double timeout) {
    @autoreleasepool {
        NSString *identifier = [NSString stringWithUTF8String:bundle_id];
        if (!identifier) return true;
        NSMutableArray<NSNumber *> *pids = [NSMutableArray array];
        for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:identifier]) {
            [pids addObject:@(app.processIdentifier)];
            [app terminate];
        }
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
        while (pids.count) {
            NSIndexSet *gone = [pids indexesOfObjectsPassingTest:^BOOL(NSNumber *pid, __unused NSUInteger i, __unused BOOL *stop) {
                return kill(pid.intValue, 0) == -1 && errno == ESRCH;
            }];
            [pids removeObjectsAtIndexes:gone];
            if (!pids.count) break;
            if ([deadline timeIntervalSinceNow] <= 0) return false;
            usleep(100 * 1000);
        }
        return true;
    }
}

// ——— Caps Lock as the hotkey ———
// While Sushi runs, every keyboard maps Caps Lock to F18 through the HID event system's
// UserKeyMapping, as `hidutil property --set` does; Sushi registers F18 as an ordinary
// hotkey. No permission is involved. Other entries of each keyboard's mapping stay.
static const unsigned long long CAPS_LOCK = 0x700000039, F18 = 0x70000006D;
static IOHIDEventSystemClientRef hid;
static bool caps_taken;
static IONotificationPortRef keyboard_port;
static io_iterator_t keyboards_added;

static NSArray *keyboards(void) {
    if (!hid) hid = IOHIDEventSystemClientCreateSimpleClient(kCFAllocatorDefault);
    NSArray *services = CFBridgingRelease(IOHIDEventSystemClientCopyServices(hid));
    NSMutableArray *found = [NSMutableArray array];
    for (id service in services) {
        // Generic Desktop / Keyboard
        if (IOHIDServiceClientConformsTo((__bridge IOHIDServiceClientRef)service, 1, 6)) [found addObject:service];
    }
    return found;
}

static NSArray<NSDictionary *> *key_mapping(id service) {
    id value = CFBridgingRelease(IOHIDServiceClientCopyProperty((__bridge IOHIDServiceClientRef)service, CFSTR("UserKeyMapping")));
    return [value isKindOfClass:NSArray.class] ? value : @[];
}

static BOOL maps_caps_lock(NSDictionary *entry) {
    return [entry[@"HIDKeyboardModifierMappingSrc"] unsignedLongLongValue] == CAPS_LOCK;
}

static BOOL is_ours(NSDictionary *entry) {
    return maps_caps_lock(entry) && [entry[@"HIDKeyboardModifierMappingDst"] unsignedLongLongValue] == F18;
}

static void set_mapping(id service, NSArray *mapping) {
    IOHIDServiceClientSetProperty((__bridge IOHIDServiceClientRef)service, CFSTR("UserKeyMapping"), (__bridge CFArrayRef)mapping);
}

static void map_all_keyboards(void) {
    for (id service in keyboards()) {
        NSArray *mapping = key_mapping(service);
        if ([mapping indexOfObjectPassingTest:^BOOL(NSDictionary *e, __unused NSUInteger i, __unused BOOL *stop) { return maps_caps_lock(e); }] != NSNotFound) continue;
        set_mapping(service, [mapping arrayByAddingObject:@{@"HIDKeyboardModifierMappingSrc": @(CAPS_LOCK), @"HIDKeyboardModifierMappingDst": @(F18)}]);
    }
}

static void drain(io_iterator_t iterator) {
    io_object_t service;
    while ((service = IOIteratorNext(iterator))) IOObjectRelease(service);
}

// A keyboard connected later gets the mapping too; the event system lists it a moment after IOKit does.
static void keyboard_added(__unused void *context, io_iterator_t iterator) {
    drain(iterator);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (caps_taken) map_all_keyboards();
    });
}

static void watch_keyboards(void) {
    if (keyboard_port) return;
    keyboard_port = IONotificationPortCreate(kIOMainPortDefault);
    IONotificationPortSetDispatchQueue(keyboard_port, dispatch_get_main_queue());
    if (IOServiceAddMatchingNotification(keyboard_port, kIOFirstMatchNotification, IOServiceMatching("IOHIDEventService"),
                                         keyboard_added, NULL, &keyboards_added) == KERN_SUCCESS) {
        drain(keyboards_added);
    }
}

// 0: Caps Lock now opens Sushi. 1: macOS switches input sources with Caps Lock.
// 2: another tool (Raycast's Hyper key, hidutil) already maps Caps Lock. Runs on the main thread.
int sushi_caps_take(void) {
    @autoreleasepool {
        id switching = CFBridgingRelease(CFPreferencesCopyAppValue(CFSTR("TISRomanSwitchState"), CFSTR("com.apple.HIToolbox")));
        if ([switching respondsToSelector:@selector(boolValue)] && [switching boolValue]) return 1;
        for (id service in keyboards()) {
            for (NSDictionary *entry in key_mapping(service)) {
                if (maps_caps_lock(entry) && !is_ours(entry)) return 2;
            }
        }
        caps_taken = true;
        map_all_keyboards();
        watch_keyboards();
        return 0;
    }
}

// Gives Caps Lock back. Also clears a mapping a crashed run left behind.
void sushi_caps_release(void) {
    @autoreleasepool {
        caps_taken = false;
        for (id service in keyboards()) {
            NSArray *mapping = key_mapping(service);
            NSIndexSet *ours = [mapping indexesOfObjectsPassingTest:^BOOL(NSDictionary *e, __unused NSUInteger i, __unused BOOL *stop) { return is_ours(e); }];
            if (!ours.count) continue;
            NSMutableArray *rest = [mapping mutableCopy];
            [rest removeObjectsAtIndexes:ours];
            set_mapping(service, rest);
        }
    }
}

void sushi_stage_appearance(const char *name) {
    if (!strcmp(name, "dark")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    else if (!strcmp(name, "light")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
}

// Stage mode: render the window for screenshots without anyone seeing it. WindowServer
// only composites glass over what lies below it on a display, so both the window and its
// backdrop sit under the desktop picture instead of off-screen. They never take focus.
static NSWindow *backdrop;

// Level of the desktop picture covering rect (AppKit coordinates), or NSNotFound.
// macOS 26+ draws it in a WallpaperAgent window two levels below kCGDesktopWindowLevel.
static NSInteger wallpaper_level(NSRect rect) {
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
    CGRect target = CGRectMake(NSMinX(rect), top - NSMaxY(rect), NSWidth(rect), NSHeight(rect));
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    NSInteger level = NSNotFound;
    for (NSDictionary *info in (__bridge NSArray *)list) {
        CGRect bounds;
        NSInteger layer = [info[(id)kCGWindowLayer] integerValue];
        NSString *owner = [NSRunningApplication runningApplicationWithProcessIdentifier:[info[(id)kCGWindowOwnerPID] intValue]].bundleIdentifier;
        if (([owner isEqual:@"com.apple.wallpaper.agent"] || layer == CGWindowLevelForKey(kCGDesktopWindowLevelKey)) &&
            [info[(id)kCGWindowAlpha] doubleValue] == 1.0 &&
            CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds) &&
            CGRectContainsRect(bounds, target)) {
            level = MIN(level, layer);
        }
    }
    if (list) CFRelease(list);
    return level;
}

long sushi_stage_present(void *native, const char *image_path, long *backdrop_number) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSRect frame = window.frame;
    NSRect around = NSInsetRect(frame, -160, -160);
    NSInteger wallpaper = wallpaper_level(NSInsetRect(around, -80, -80));
    if (wallpaper == NSNotFound) {
        fprintf(stderr, "SUSHI_STAGE: no desktop picture covers the stage area; refusing to show windows.\n");
        return -1;
    }
    NSInteger below = wallpaper - 1;

    NSImage *image = nil;
    if (image_path) image = [[NSImage alloc] initWithContentsOfFile:@(image_path)];
    if (!image && NSScreen.mainScreen) {
        NSURL *url = [NSWorkspace.sharedWorkspace desktopImageURLForScreen:NSScreen.mainScreen];
        if (url) image = [[NSImage alloc] initWithContentsOfURL:url];
    }
    backdrop = [[NSWindow alloc] initWithContentRect:around styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    backdrop.releasedWhenClosed = NO;
    backdrop.ignoresMouseEvents = YES;
    backdrop.hasShadow = NO;
    backdrop.level = below - 1;
    NSView *content = backdrop.contentView;
    content.wantsLayer = YES;
    if (image) {
        content.layer.contents = image;
        content.layer.contentsGravity = kCAGravityResizeAspectFill;
    } else {
        CAGradientLayer *gradient = [CAGradientLayer layer];
        gradient.frame = content.bounds;
        gradient.colors = @[(id)[NSColor colorWithSRGBRed:0.10 green:0.12 blue:0.22 alpha:1].CGColor,
                            (id)[NSColor colorWithSRGBRed:0.35 green:0.15 blue:0.30 alpha:1].CGColor];
        [content.layer addSublayer:gradient];
    }
    // Under the wallpaper the window counts as occluded and WebKit would stop painting
    // after the stage script reloads the page. Stage-only use of WebKit SPI.
    SEL occlusion = NSSelectorFromString(@"_setWindowOcclusionDetectionEnabled:");
    for (NSView *parent in window.contentView.subviews) {
        for (NSView *view in [parent.subviews arrayByAddingObject:parent]) {
            if ([view respondsToSelector:occlusion]) ((void (*)(id, SEL, BOOL))objc_msgSend)(view, occlusion, NO);
        }
    }
    window.ignoresMouseEvents = YES;
    window.level = below;
    window.hasShadow = YES;
    [backdrop orderFrontRegardless];
    [window orderFrontRegardless];
    refresh_shadow(window);

    signal(SIGTERM, SIG_IGN);
    static dispatch_source_t term;
    term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(term, ^{ exit(0); });
    dispatch_resume(term);
    *backdrop_number = backdrop.windowNumber;
    return window.windowNumber;
}
