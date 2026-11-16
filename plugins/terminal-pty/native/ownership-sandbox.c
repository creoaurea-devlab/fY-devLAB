/* Linux ownership write lock. No privileges or namespace changes are needed.
 * The trusted server owns the allowlist; the child can only narrow this policy.
 * This is an offline local write boundary, not a confidential-read sandbox. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET
#define LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#define LANDLOCK_SCOPE_SIGNAL (1ULL << 1)
#endif

/* ABI 6 adds scope flags after the original filesystem/network fields. */
struct scoped_ruleset {
    uint64_t handled_access_fs;
    uint64_t handled_access_net;
    uint64_t scoped;
};

static void fail(const char *message) {
    fprintf(stderr, "Strict ownership unavailable: %s: %s\n", message, strerror(errno));
    exit(125);
}

static void invalid(const char *message) {
    errno = EINVAL;
    fail(message);
}

static uint64_t write_rights(void) {
    return LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE |
        LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
        LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |
        LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |
        LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
        LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER;
}

static void add_path(int ruleset, const char *path, int scratch) {
    int fd = open(path, O_PATH | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) fail("open policy path");
    struct stat info;
    if (fstat(fd, &info)) fail("inspect policy path");
    if (scratch ? (!S_ISDIR(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 077) != 0)
                : (!S_ISREG(info.st_mode) || info.st_nlink != 1))
        invalid("policy path must be a private directory or an unaliased regular file");
    struct landlock_path_beneath_attr rule = {
        .parent_fd = fd,
        .allowed_access = scratch ? write_rights()
                                 : LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE,
    };
    if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0))
        fail("add ownership policy");
    close(fd);
}

#define DENY(call) \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##call, 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

static void restrict_syscalls(void) {
#if defined(__x86_64__)
    const uint32_t architecture = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
    const uint32_t architecture = AUDIT_ARCH_AARCH64;
#else
#error Unsupported architecture: supply a reviewed syscall filter first.
#endif
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, architecture, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        /* Reject x32 and other alternate syscall encodings. */
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000U, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        /* No network, host control sockets, or inherited socket hand-offs. */
        DENY(socket), DENY(socketpair), DENY(connect), DENY(bind),
        DENY(listen), DENY(accept), DENY(accept4), DENY(sendmsg), DENY(sendmmsg),
        DENY(sendto), DENY(recvmsg), DENY(recvmmsg),
        DENY(shmget), DENY(shmat), DENY(shmdt), DENY(shmctl),
        DENY(msgget), DENY(msgsnd), DENY(msgrcv), DENY(msgctl),
        DENY(semget), DENY(semop), DENY(semtimedop), DENY(semctl),
        DENY(mq_open), DENY(mq_unlink), DENY(mq_timedsend),
        DENY(mq_timedreceive), DENY(mq_notify), DENY(mq_getsetattr),
        /* Prevent writing through another process or obtaining its descriptors. */
        DENY(ptrace), DENY(process_vm_writev), DENY(process_vm_readv),
        DENY(pidfd_open), DENY(pidfd_getfd), DENY(pidfd_send_signal),
        DENY(kcmp),
        /* io_uring must not offer a second syscall path around this filter. */
        DENY(io_uring_setup), DENY(io_uring_enter), DENY(io_uring_register),
        DENY(bpf), DENY(perf_event_open), DENY(userfaultfd),
        DENY(mount), DENY(umount2), DENY(pivot_root), DENY(unshare), DENY(setns),
        DENY(open_by_handle_at), DENY(name_to_handle_at),
        DENY(fsopen), DENY(fsconfig), DENY(fsmount), DENY(move_mount),
        DENY(open_tree), DENY(mount_setattr),
        DENY(add_key), DENY(request_key), DENY(keyctl),
        /* Landlock's file-content policy does not mediate these metadata writes.
         * Refuse them, including on owned files, rather than leaking sibling edits. */
        DENY(chmod), DENY(fchmod), DENY(fchmodat),
#ifdef SYS_fchmodat2
        DENY(fchmodat2),
#endif
        DENY(chown), DENY(fchown), DENY(lchown), DENY(fchownat),
        DENY(utime), DENY(utimes), DENY(futimesat), DENY(utimensat),
        DENY(setxattr), DENY(lsetxattr), DENY(fsetxattr),
        DENY(removexattr), DENY(lremovexattr), DENY(fremovexattr),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = {
        .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
        .filter = filter,
    };
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail("install syscall restrictions");
}

int main(int argc, char **argv) {
    if (geteuid() == 0 || getuid() != geteuid())
        invalid("run Strict ownership as an ordinary unprivileged user");
    int abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 6) {
        if (abi >= 0) errno = ENOTSUP;
        fail("Linux Landlock ABI 6 or newer is required");
    }
    /* No ambient parent descriptors are allowed to bypass pathname policy. */
    if (syscall(SYS_close_range, 3U, ~0U, 0)) fail("close inherited descriptors");
    int check = argc == 2 && strcmp(argv[1], "--check") == 0;
    struct scoped_ruleset policy = {
        .handled_access_fs = write_rights(),
        .handled_access_net = LANDLOCK_ACCESS_NET_BIND_TCP | LANDLOCK_ACCESS_NET_CONNECT_TCP,
        .scoped = LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET | LANDLOCK_SCOPE_SIGNAL,
    };
    int ruleset = (int)syscall(SYS_landlock_create_ruleset, &policy, sizeof(policy), 0);
    if (ruleset < 0) fail("create ownership policy");
    int payload = 0, scratch_count = 0, file_count = 0;
    if (!check) {
        for (int i = 1; i < argc; ++i) {
            if (strcmp(argv[i], "--") == 0) { payload = i + 1; break; }
            if (i + 1 >= argc) invalid("missing policy argument");
            if (strcmp(argv[i], "--scratch") == 0) {
                add_path(ruleset, argv[++i], 1);
                ++scratch_count;
            } else if (strcmp(argv[i], "--file") == 0) {
                add_path(ruleset, argv[++i], 0);
                ++file_count;
            } else invalid("unknown policy argument");
        }
        if (!payload || payload >= argc || scratch_count != 1 || file_count < 1)
            invalid("require one private scratch, owned files, and explicit executable");
    }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("disable privilege gain");
    if (syscall(SYS_landlock_restrict_self, ruleset, 0)) fail("enforce ownership policy");
    close(ruleset);
    restrict_syscalls();
    if (check) {
        printf("strict-ready landlock-abi=%d offline=1\n", abi);
        return 0;
    }
    /* Shells do not inherit host startup hooks or a tmux control endpoint. */
    unsetenv("TMUX"); unsetenv("TMUX_PANE");
    unsetenv("BASH_ENV"); unsetenv("ENV"); unsetenv("PROMPT_COMMAND");
    execv(argv[payload], &argv[payload]);
    fail("execute confined program");
}
